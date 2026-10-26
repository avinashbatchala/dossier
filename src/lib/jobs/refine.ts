import "server-only";

import { z } from "zod";

import { ChatRole, DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { refineChat, type ChatTurn } from "@/lib/ai/tasks";
import { extractedOf, unitsSchema, type Unit, type UnitEdit } from "@/lib/application-data";
import { updateDocuments } from "@/lib/document-units";
import { withoutPrivateParts } from "@/lib/letter-frame";
import { prisma } from "@/lib/prisma";
import { loadFactTexts, loadProfile } from "@/lib/profile-data";
import { unitName } from "@/lib/unit-text";

import { defineJob } from "./runner";

/** The key of an application's refine requests, to find one again after a reload. */
export const refineJobKey = (applicationId: string) => `refine:${applicationId}`;

const unitRef = z.object({ document: z.enum(DocumentKind), unitId: z.string().min(1) });

/** "A, B and C" */
const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Answers a message in the Refine with AI panel (E8-5, APP-7, APP-9): the
 * reply, the unit edits it asks for and a new letter tone, saved together
 * with the reply. An edit only lands on a unit that still reads as the model
 * saw it; the reply mentions any it left alone.
 */
export const refineJob = defineJob({
  type: "refine",
  input: z.object({
    applicationId: z.string().min(1),
    /** The user's message, saved before the job started. */
    messageId: z.string().min(1),
    request: z.string().min(1),
    /** The unit picked with "Ask AI", if any. */
    target: unitRef.nullable(),
    /** The document on screen. */
    viewing: z.enum(DocumentKind).nullable(),
  }),
  result: z.object({
    /** The AI's reply. */
    messageId: z.string(),
    /** The units it changed, to show them. */
    edited: z.array(unitRef),
  }),
  async run({ applicationId, messageId, request, target, viewing }, { step, signal }) {
    await step("Thinking");
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { documents: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    const unitsOf = (kind: DocumentKind): Unit[] => {
      const parsed = unitsSchema.safeParse(application.documents.find((document) => document.kind === kind)?.units);
      return parsed.success ? parsed.data : [];
    };
    const resume = unitsOf(DocumentKind.RESUME);
    // The letter's sender and signature hold contact details, which never go to the model (E8-11).
    const letter = withoutPrivateParts(unitsOf(DocumentKind.COVER_LETTER));

    // The conversation before this message.
    const index = application.messages.findIndex((message) => message.id === messageId);
    const history: ChatTurn[] = application.messages.slice(0, index < 0 ? undefined : index).map((message) =>
      message.role === ChatRole.USER
        ? { role: "user", text: message.targetUnit ? `About ${message.targetUnit}: ${message.text}` : message.text }
        : { role: "assistant", text: message.text },
    );
    const targetUnit = target && unitsOf(target.document).find((unit) => unit.id === target.unitId);

    const [provider, options, profile, facts] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile(), loadFactTexts(applicationId)]);
    const { data, promptVersion } = await refineChat(
      provider,
      {
        request,
        history,
        target: targetUnit ? `${targetUnit.label} (${targetUnit.id})` : null,
        viewing,
        resume,
        letter,
        email: unitsOf(DocumentKind.EMAIL),
        profile,
        extracted: extractedOf(application),
        tone: application.tone,
        facts,
        posting: application.postingText,
      },
      // The documents are in this language, so edits are too.
      { ...options, language: application.language || options.language, signal },
    );

    return updateDocuments(applicationId, async (documents, tx) => {
      const applied: UnitEdit[] = [];
      const leftAlone: string[] = [];
      for (const edit of data.edits) {
        const unit = documents[edit.document]?.find((entry) => entry.id === edit.unitId);
        if (!unit) continue;
        if (unit.text !== edit.previousText) {
          leftAlone.push(`the ${unitName(unit)}`);
          continue;
        }
        unit.text = edit.text;
        if (edit.unverified?.length) unit.unverified = edit.unverified;
        else delete unit.unverified;
        applied.push(edit);
      }
      if (data.tone) await tx.application.update({ where: { id: applicationId }, data: { tone: data.tone } });

      const note =
        leftAlone.length > 0
          ? ` I left ${listOf(leftAlone)} as ${leftAlone.length === 1 ? "it is: it" : "they are: they"} changed while I was working.`
          : "";
      const reply = await tx.chatMessage.create({
        data: {
          applicationId,
          role: ChatRole.AI,
          text: `${data.reply}${note}`,
          ...(applied.length > 0 ? { edits: applied } : {}),
          previousTone: data.tone ? application.tone : null,
          writtenWith: promptVersion,
        },
        select: { id: true },
      });
      return { messageId: reply.id, edited: applied.map(({ document, unitId }) => ({ document, unitId })) };
    }, { version: { cause: VersionCause.REFINED, detail: request } });
  },
});

export type RefineResult = z.infer<typeof refineJob.result>;
