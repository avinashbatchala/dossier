"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { ChatRole, DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { isAiConfigured } from "@/lib/ai/config";
import { editsSchema, extractedSchema, matchSchema, trimmedSchema, unitsSchema, withSkillAdded } from "@/lib/application-data";
import { WRITTEN_EMAIL_UNITS } from "@/lib/application-email";
import { updateDocuments } from "@/lib/document-units";
import { DOCUMENT_LABELS } from "@/lib/file-name";
import { syncInterviewToCalendar } from "@/lib/google/availability";
import { GoogleError } from "@/lib/google/errors";
import { isFrameUnit, withFrame, WRITTEN_FRAME_UNITS } from "@/lib/letter-frame";
import { saveVersion } from "@/lib/document-versions";
import { refineJob, refineJobKey } from "@/lib/jobs/refine";
import { regenerateUnitJob, unitJobKey } from "@/lib/jobs/regenerate-unit";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { emailJobKey, writeEmailJob } from "@/lib/jobs/write-email";
import { prisma } from "@/lib/prisma";
import { findOrCreateSkill } from "@/lib/profile-entries";
import { cleanUnitText, unitName } from "@/lib/unit-text";

const GONE = "That application no longer exists.";
const PART_GONE = "That part of the document no longer exists. Reload the page to see what's there now.";

const refresh = (id: string) => revalidatePath(`/applications/${id}`);

/** The Resume tab's layout switch (APP-4): the theme's own layout, or a single column. */
export const setFollowThemeLayout = action(
  z.object({ id: z.string().min(1), follow: z.boolean() }),
  async ({ id, follow }) => {
    const { count } = await prisma.application.updateMany({ where: { id }, data: { followThemeLayout: follow } });
    if (count === 0) throw new ActionError(GONE);
    refresh(id);
    return null;
  },
);

/**
 * The next interview's date and time (E9-9), or null to remove it. It shows
 * on the dashboard's "Worth a look" while the application is in Interview,
 * and while Dossier keeps interviews in Google Calendar, the event is added,
 * moved or deleted to match.
 */
export const setInterviewDate = action(
  z.object({ id: z.string().min(1), at: z.iso.datetime().nullable() }),
  async ({ id, at }, { toast }) => {
    const { count } = await prisma.application.updateMany({ where: { id }, data: { nextInterviewAt: at ? new Date(at) : null } });
    if (count === 0) throw new ActionError(GONE);
    refresh(id);
    try {
      const { inCalendar } = await syncInterviewToCalendar(id);
      if (inCalendar) toast(at ? "Interview date saved, in your calendar too." : "Interview date removed, from your calendar too.");
      else toast(at ? "Interview date saved. It'll show on your dashboard." : "Interview date removed.");
    } catch (error) {
      if (!(error instanceof GoogleError)) throw error;
      toast(`${at ? "Interview date saved" : "Interview date removed"}, but your calendar wasn't changed: ${error.message}`);
    }
    return null;
  },
);

/**
 * Saves a unit edited by hand (APP-6). `expected` is the text the editor
 * started from: if the unit changed since (an AI rewrite that finished
 * meanwhile), nothing is saved, so neither version is lost unseen. The
 * text is the user's own, so the fact guard's hints go.
 */
export const saveUnit = action(
  z.object({
    id: z.string().min(1),
    document: z.enum(DocumentKind),
    unitId: z.string().min(1),
    text: z.string().max(10_000),
    expected: z.string(),
  }),
  async ({ id, document, unitId, text, expected }) => {
    const clean = cleanUnitText(unitId, text);
    // The email's recipient may be left empty, for the mail app to fill in.
    if (!clean && !(document === DocumentKind.EMAIL && unitId === "to")) {
      throw new ActionError("Write something first, or cancel to keep it as it was.");
    }

    await updateDocuments(id, async (documents) => {
      const units = documents[document];
      const unit = units?.find((entry) => entry.id === unitId);
      // A letter written before E8-11 shows its frame without storing it: the first edit stores that part.
      if (!unit && units && document === DocumentKind.COVER_LETTER && isFrameUnit(unitId)) {
        documents[document] = withFrame(units, { [unitId]: clean });
        return;
      }
      if (!unit) throw new ActionError(PART_GONE);
      if (unit.text !== expected) {
        throw new ActionError("This part changed while you were editing it. Copy your text, cancel, and edit the new version.");
      }
      unit.text = clean;
      delete unit.unverified;
    });
    refresh(id);
    return { text: clean };
  },
);

const unitInput = { id: z.string().min(1), document: z.enum(DocumentKind), unitId: z.string().min(1) };

/**
 * "Regenerate" (E8-4): rewrites one unit in the background and returns the
 * job's id. Asking again while it's being rewritten follows the same job.
 */
export const startRegenerating = action(
  z.object({
    ...unitInput,
    /** For a letter part an older letter only shows (E8-11): the text on screen, stored before it's rewritten. */
    shown: z.string().trim().min(1).max(2000).optional(),
  }),
  async ({ id, document, unitId, shown }) => {
    const frame = document === DocumentKind.COVER_LETTER && isFrameUnit(unitId);
    // The sender, date and signature come from the profile and the day, not the AI (E8-11).
    if ((frame && !WRITTEN_FRAME_UNITS.has(unitId)) || (document === DocumentKind.EMAIL && !WRITTEN_EMAIL_UNITS.has(unitId))) {
      throw new ActionError("This part isn't written by the AI. Edit it instead.");
    }
    if (frame && shown) {
      await updateDocuments(id, async (documents) => {
        const units = documents[document];
        if (units && !units.some((entry) => entry.id === unitId)) documents[document] = withFrame(units, { [unitId]: shown });
      });
    }
    const row = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId: id, kind: document } } });
    const unit = row && unitsSchema.parse(row.units).find((entry) => entry.id === unitId);
    if (!unit) throw new ActionError(PART_GONE);

    for (const job of await findUnfinishedJobs(unitJobKey(id))) {
      const input = regenerateUnitJob.input.safeParse(job.input);
      if (input.success && input.data.document === document && input.data.unitId === unitId) return job.id;
    }
    return startJob(regenerateUnitJob, { applicationId: id, document, unitId, from: unit.text }, { key: unitJobKey(id), applicationId: id });
  },
);

/**
 * Undo on the "Rewrote the summary." toast (E8-4): puts the previous
 * version back, unless the unit has changed again since.
 */
export const restoreUnit = action(
  z.object({
    ...unitInput,
    text: z.string().max(10_000),
    unverified: z.array(z.string()).optional(),
    /** The text it has now, which Undo replaces. */
    expected: z.string(),
  }),
  async ({ id, document, unitId, text, unverified, expected }) => {
    await updateDocuments(id, async (documents) => {
      const unit = documents[document]?.find((entry) => entry.id === unitId);
      if (!unit) throw new ActionError(PART_GONE);
      if (unit.text !== expected) throw new ActionError("It's been changed again since, so this can't be undone.");
      unit.text = text;
      if (unverified?.length) unit.unverified = unverified;
      else delete unit.unverified;
    }, { version: { cause: VersionCause.UNDONE } });
    refresh(id);
    return null;
  },
);

/** The answer on the Job posting tab, where there's nothing to change. */
const POSTING_REPLY = "I can change the resume, the cover letter or the email. Switch to one of them, or hover a section and pick “Ask AI”.";

/**
 * Sends a message from the Refine with AI panel (E8-5): saves it and starts
 * the reply in the background, returning the job's id. On the Job posting
 * tab without a picked unit, the reply comes at once and needs no AI.
 */
export const sendMessage = action(
  z.object({
    id: z.string().min(1),
    text: z.string().trim().min(1, "Write what should change first.").max(2000),
    /** The document on screen; null on the Job posting and Notes tabs, and on the Email tab before there's an email. */
    viewing: z.enum(DocumentKind).nullable(),
    /** The unit picked with "Ask AI". */
    target: z.object({ document: z.enum(DocumentKind), unitId: z.string().min(1) }).nullable(),
  }),
  async ({ id, text, viewing, target }) => {
    if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);

    if (!viewing && !target) {
      const now = Date.now();
      await prisma.chatMessage.createMany({
        data: [
          { applicationId: id, role: ChatRole.USER, text, createdAt: new Date(now) },
          { applicationId: id, role: ChatRole.AI, text: POSTING_REPLY, createdAt: new Date(now + 1) },
        ],
      });
      refresh(id);
      return { jobId: null };
    }

    if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
    if ((await findUnfinishedJobs(refineJobKey(id))).length > 0) {
      throw new ActionError("I'm still working on your last message. Send this one when I'm done.");
    }
    let targetLabel: string | null = null;
    if (target) {
      const row = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId: id, kind: target.document } } });
      const unit = row && unitsSchema.parse(row.units).find((entry) => entry.id === target.unitId);
      if (!unit) throw new ActionError(PART_GONE);
      targetLabel = unit.label;
    }

    const message = await prisma.chatMessage.create({
      data: { applicationId: id, role: ChatRole.USER, text, targetUnit: targetLabel },
      select: { id: true },
    });
    const jobId = await startJob(refineJob, { applicationId: id, messageId: message.id, request: text, target, viewing }, { key: refineJobKey(id), applicationId: id });
    refresh(id);
    return { jobId };
  },
);

/** "A, B and C" */
const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * "Undo" under a reply in the chat (E8-6, APP-8): puts back what the reply
 * changed, units and tone, all or nothing. A unit edited again since is
 * never overwritten; the answer says which.
 */
export const undoMessage = action(z.object({ id: z.string().min(1), messageId: z.string().min(1) }), async ({ id, messageId }) => {
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, applicationId: id, role: ChatRole.AI } });
  const edits = message && editsSchema.safeParse(message.edits);
  if (!message || !edits?.success || edits.data.length === 0) throw new ActionError("There's nothing to undo in that message.");
  if (message.undone) throw new ActionError("That's already undone.");

  await updateDocuments(id, async (documents, tx) => {
    const changed = edits.data.flatMap((edit) => {
      const unit = documents[edit.document]?.find((entry) => entry.id === edit.unitId);
      return unit?.text === edit.text ? [] : [`the ${unitName(unit ?? { id: edit.unitId, label: "" })}`];
    });
    if (changed.length > 0) {
      throw new ActionError(
        `You've changed ${listOf(changed)} since, so undoing this would overwrite that. Edit ${changed.length === 1 ? "it" : "them"} by hand instead.`,
      );
    }
    for (const edit of edits.data) {
      const unit = documents[edit.document]!.find((entry) => entry.id === edit.unitId)!;
      unit.text = edit.previousText;
      if (edit.previousUnverified?.length) unit.unverified = edit.previousUnverified;
      else delete unit.unverified;
    }
    if (message.previousTone) await tx.application.update({ where: { id }, data: { tone: message.previousTone } });
    // Only once, even when two clicks race.
    const { count } = await tx.chatMessage.updateMany({ where: { id: messageId, undone: false }, data: { undone: true } });
    if (count === 0) throw new ActionError("That's already undone.");
  }, { version: { cause: VersionCause.UNDONE } });
  refresh(id);
  return { edited: edits.data.map(({ document, unitId }) => ({ document, unitId })) };
});

/**
 * "+ Add to profile" on the Job posting tab (E8-7, NEW-5): adds a missing
 * skill to the profile, and the requirement becomes partly covered.
 */
export const addMatchSkill = action(z.object({ id: z.string().min(1), index: z.number().int().min(0) }), async ({ id, index }) => {
  const application = await prisma.application.findUnique({ where: { id }, select: { match: true, extracted: true } });
  if (!application) throw new ActionError(GONE);
  const match = matchSchema.safeParse(application.match);
  const extracted = extractedSchema.safeParse(application.extracted);
  const item = match.success ? match.data.items[index] : undefined;
  const requirement = extracted.success ? extracted.data.requirements[index] : undefined;
  if (!match.success || !item || item.result !== "gap" || requirement?.kind !== "skill" || !requirement.skill) {
    throw new ActionError("That requirement can't be added to your profile. Reload the page to see what's there now.");
  }

  const { skill } = await findOrCreateSkill(requirement.skill.trim());
  const items = match.data.items.map((entry, position) => (position === index ? withSkillAdded(entry, skill.name) : entry));
  await prisma.application.update({ where: { id }, data: { match: { items } } });
  refresh(id);
  return { name: skill.name };
});

// Private notes (E8-9, APP-14). They stay on this server and never go into
// a prompt: no AI task reads the Note table.

const noteBody = z.string().trim().min(1, "Write something first.").max(5000);

export const addNote = action(z.object({ id: z.string().min(1), body: noteBody }), async ({ id, body }) => {
  if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);
  await prisma.note.create({ data: { applicationId: id, body } });
  refresh(id);
  return null;
});

const NOTE_GONE = "That note no longer exists.";

export const updateNote = action(
  z.object({ id: z.string().min(1), noteId: z.string().min(1), body: noteBody }),
  async ({ id, noteId, body }) => {
    const { count } = await prisma.note.updateMany({ where: { id: noteId, applicationId: id }, data: { body } });
    if (count === 0) throw new ActionError(NOTE_GONE);
    refresh(id);
    return null;
  },
);

/** Deletes a note at once; it comes back with its date through `restoreNote` (Undo on the toast). */
export const deleteNote = action(z.object({ id: z.string().min(1), noteId: z.string().min(1) }), async ({ id, noteId }) => {
  const note = await prisma.note.findFirst({ where: { id: noteId, applicationId: id } });
  if (!note) throw new ActionError(NOTE_GONE);
  await prisma.note.delete({ where: { id: note.id } });
  refresh(id);
  return { body: note.body, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() };
});

export const restoreNote = action(
  z.object({ id: z.string().min(1), body: noteBody, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }),
  async ({ id, body, createdAt, updatedAt }) => {
    if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);
    await prisma.note.create({ data: { applicationId: id, body, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) } });
    refresh(id);
    return null;
  },
);

/**
 * "Put back" (E10-10): restores a role or bullets left out to fit the page limit.
 * Putting back twice changes nothing more.
 */
export const putBackTrimmed = action(z.object({ id: z.string().min(1), index: z.number().int().min(0) }), async ({ id, index }) => {
  const row = await prisma.document.findUnique({ where: { applicationId_kind: { applicationId: id, kind: DocumentKind.RESUME } } });
  const trimmed = row ? trimmedSchema.safeParse(row.trimmed) : null;
  const item = trimmed?.success ? trimmed.data[index] : undefined;
  if (!row || !trimmed?.success || !item) throw new ActionError("That's already back. Reload the page to see the resume as it is.");

  await updateDocuments(id, async (documents) => {
    const units = documents[DocumentKind.RESUME];
    if (!units) throw new ActionError(PART_GONE);
    if (item.kind === "unit") {
      if (!units.some((unit) => unit.id === item.unit.id)) units.splice(Math.min(item.index, units.length), 0, item.unit);
      return;
    }
    const unit = units.find((entry) => entry.id === item.unitId);
    if (!unit) throw new ActionError(PART_GONE);
    const lines = unit.text.split("\n");
    unit.text = [...lines, ...item.lines.filter((line) => !lines.includes(line))].filter(Boolean).join("\n");
  });
  const rest = trimmed.data.filter((_, position) => position !== index);
  await prisma.document.update({ where: { id: row.id }, data: { trimmed: rest.length > 0 ? rest : Prisma.DbNull } });
  refresh(id);
  return null;
});

// ─── Versions (E8-10, APP-13) ────────────────────────────────────────────────

const VERSION_GONE = "That version no longer exists. Open the history again to see what's there.";

/** A document's versions, newest first, without their units. */
export const listVersions = action(z.object({ id: z.string().min(1), document: z.enum(DocumentKind) }), async ({ id, document }) => {
  const versions = await prisma.documentVersion.findMany({
    where: { document: { applicationId: id, kind: document } },
    orderBy: { createdAt: "desc" },
    select: { id: true, cause: true, detail: true, createdAt: true },
  });
  return versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() }));
});

/** One version's units, to look at before restoring it. */
export const loadVersion = action(z.object({ id: z.string().min(1), versionId: z.string().min(1) }), async ({ id, versionId }) => {
  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, document: { applicationId: id } },
    select: { units: true, document: { select: { kind: true } } },
  });
  if (!version) throw new ActionError(VERSION_GONE);
  return { document: version.document.kind, units: unitsSchema.parse(version.units) };
});

/**
 * Brings back an earlier version. The document as it is now is saved as a
 * version first (unless it's already the newest), so nothing is lost, and
 * the restored state becomes a version of its own.
 */
export const restoreVersion = action(z.object({ id: z.string().min(1), versionId: z.string().min(1) }), async ({ id, versionId }, { toast }) => {
  const version = await prisma.documentVersion.findFirst({
    where: { id: versionId, document: { applicationId: id } },
    select: { units: true, createdAt: true, document: { select: { id: true, kind: true } } },
  });
  if (!version) throw new ActionError(VERSION_GONE);
  const { kind } = version.document;
  const units = unitsSchema.parse(version.units);

  const stillLeftOut = await updateDocuments(
    id,
    async (documents, tx) => {
      const current = documents[kind];
      if (!current) throw new ActionError(PART_GONE);
      if (JSON.stringify(current) === JSON.stringify(units)) throw new ActionError("That's the version you have now.");
      const newest = await tx.documentVersion.findFirst({ where: { documentId: version.document.id }, orderBy: { createdAt: "desc" }, select: { units: true } });
      if (!newest || JSON.stringify(unitsSchema.parse(newest.units)) !== JSON.stringify(current)) {
        await saveVersion(tx, version.document.id, current, { cause: VersionCause.BEFORE_RESTORE });
      }
      documents[kind] = units;
      // Parts left out to fit the page limit that the restored version has again are no longer left out.
      if (kind !== DocumentKind.RESUME) return null;
      const row = await tx.document.findUniqueOrThrow({ where: { id: version.document.id }, select: { trimmed: true } });
      const trimmed = trimmedSchema.safeParse(row.trimmed);
      if (!trimmed.success) return null;
      return trimmed.data.filter((cut) =>
        cut.kind === "unit"
          ? !units.some((unit) => unit.id === cut.unit.id)
          : !cut.lines.every((line) => units.find((unit) => unit.id === cut.unitId)?.text.includes(line)),
      );
    },
    { version: { cause: VersionCause.RESTORED, detail: version.createdAt.toISOString() } },
  );
  // Written after the document itself: updateDocuments checks it wasn't changed meanwhile.
  if (stillLeftOut) {
    await prisma.document.update({
      where: { id: version.document.id },
      data: { trimmed: stillLeftOut.length > 0 ? stillLeftOut : Prisma.DbNull },
    });
  }
  toast(`Restored the ${DOCUMENT_LABELS[kind].toLowerCase()} as it was then. The version you had is in the history too.`);
  refresh(id);
  return null;
});

// ─── The email (Email tab) ───────────────────────────────────────────────────

/**
 * "Write the email" and "Rewrite": writes the application's email in the
 * background and returns the job's id. Asking again while it's being
 * written follows the same job.
 */
export const startWritingEmail = action(z.object({ id: z.string().min(1) }), async ({ id }) => {
  if (!(await prisma.application.count({ where: { id } }))) throw new ActionError(GONE);
  if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
  const [running] = await findUnfinishedJobs(emailJobKey(id));
  return running?.id ?? startJob(writeEmailJob, { applicationId: id }, { key: emailJobKey(id), applicationId: id });
});

/**
 * Undo on the "Rewrote the email." toast: puts back the email the rewrite
 * replaced, unless it has changed again since.
 */
export const undoEmailRewrite = action(z.object({ id: z.string().min(1), jobId: z.string().min(1) }), async ({ id, jobId }) => {
  const job = await prisma.job.findFirst({ where: { id: jobId, key: emailJobKey(id), status: "DONE" }, select: { result: true } });
  const result = writeEmailJob.result.safeParse(job?.result);
  const previous = result.success ? result.data.previous : null;
  if (!result.success || !previous) throw new ActionError("There's nothing to undo.");

  const same = (a: unknown, b: unknown) => JSON.stringify(unitsSchema.parse(a)) === JSON.stringify(unitsSchema.parse(b));
  await updateDocuments(id, async (documents) => {
    const current = documents[DocumentKind.EMAIL];
    if (!current) throw new ActionError(PART_GONE);
    if (!same(current, result.data.units)) {
      throw new ActionError("The email has changed since, so this can't be undone. Earlier versions are in its history.");
    }
    documents[DocumentKind.EMAIL] = previous;
  }, { version: { cause: VersionCause.UNDONE } });
  refresh(id);
  return null;
});
