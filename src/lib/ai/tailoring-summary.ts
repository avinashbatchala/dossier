import type { Tone } from "@/generated/prisma/enums";
import type { Match, Unit } from "@/lib/application-data";
import { isParagraph } from "@/lib/letter-frame";
import { sameName, type ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";

// The first message on a new application: what was tailored (E7-6, SET-5).
// Built in code from the documents, the profile and the match, never written
// by the model, so it can't describe a change that didn't happen
// (decided 28 September 2026).

export type TailoringSummary = { intro: string; list: string[]; foot: string };

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** "A, B and C" */
function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function tailoringSummary({
  profile,
  company,
  role,
  match,
  resume,
  letter,
  tone,
  note,
  references,
  strict,
  showChanges,
}: {
  profile: ProfileData;
  company: string;
  role: string;
  match: Match;
  resume: Unit[];
  letter: Unit[];
  tone: Tone;
  note: string;
  /** Whether the tailored resume includes references, and why not when it doesn't. */
  references: "included" | "not-asked" | "setting-off";
  strict: boolean;
  /** Settings → "Show what changed" (SET-5). */
  showChanges: boolean;
}): TailoringSummary {
  const where = company.trim() || "this job";
  const unit = (id: string) => resume.find((entry) => entry.id === id);
  const list: string[] = [];

  const summary = unit("summary")?.text ?? "";
  const forRole = role.trim() ? `for the ${role.trim()} role` : "for this job";
  if (summary && !profile.basics.summary.trim()) list.push(`Wrote a summary ${forRole}`);
  else if (summary && !same(summary, profile.basics.summary)) list.push(`Rewrote your summary ${forRole}`);

  const reworded = profile.experience.filter((entry) => {
    const tailored = unit(`experience:${entry.id}`);
    return tailored && !same(tailored.text, entry.bullets.split("\n").map((line) => line.trim()).filter(Boolean).join("\n"));
  });
  if (reworded.length > 0) {
    list.push(
      reworded.length === profile.experience.length && reworded.length > 1
        ? `Reworded all ${reworded.length} roles to lead with what ${where} asks for`
        : `Reworded your ${listOf(reworded.map((entry) => entry.company || entry.role))} ${reworded.length === 1 ? "role" : "roles"} for this job`,
    );
  }

  const projects = profile.projects.filter((entry) => {
    const tailored = unit(`project:${entry.id}`);
    return tailored && !same(tailored.text, entry.bullets.split("\n").map((line) => line.trim()).filter(Boolean).join("\n"));
  });
  if (projects.length > 0) {
    list.push(`Reworded your ${listOf(projects.map((entry) => entry.name || "untitled"))} ${projects.length === 1 ? "project" : "projects"} for this job`);
  }

  const skills = (unit("skills")?.text ?? "").split(" · ").filter(Boolean);
  const profileSkills = profile.skills.map((skill) => skill.name);
  const kept = profileSkills.filter((name) => skills.some((skill) => sameName(skill, name)));
  if (skills.length > 1 && !skills.every((skill, index) => kept[index] && sameName(skill, kept[index]))) {
    list.push(`Ordered your skills by what ${where} asks for`);
  }
  const dropped = profileSkills.filter((name) => !skills.some((skill) => sameName(skill, name)));
  if (skills.length > 0 && dropped.length > 0) {
    list.push(dropped.length <= 3 ? `Left out ${listOf(dropped)}, which this job isn't about` : `Left out ${dropped.length} skills that don't help here`);
  }

  if (profile.references.length > 0) {
    list.push(
      references === "included"
        ? "Included your references, since the posting asks for them"
        : references === "not-asked"
          ? "Left out references, since the posting doesn't ask for them"
          : "Left out references, as set in Settings",
    );
  }

  if (letter.some(isParagraph)) list.push(`Wrote a ${TONES[tone].label.toLowerCase()} cover letter`);
  const gaps = match.items.filter((item) => item.result === "gap").map((item) => `“${item.requirement}”`);
  if (gaps.length > 0) list.push(`Worth being ready to talk about ${listOf(gaps)}, since ${gaps.length === 1 ? "it isn't" : "they aren't"} in your profile`);
  if (note.trim()) list.push(`Took your note into account: “${note.trim()}”`);

  const flagged = [...resume, ...letter].reduce((count, entry) => count + (entry.unverified?.length ?? 0), 0);
  if (strict && flagged > 0) {
    list.push(`Marked ${flagged === 1 ? "one detail" : `${flagged} details`} to check (not in your profile or the posting)`);
  }

  const foot = !strict
    ? "“Never invent experience” is off, so check the facts before you send anything."
    : flagged > 0
      ? "Double-check the marked details before you send anything."
      : "Nothing invented: every line comes from your profile.";

  return showChanges
    ? { intro: `Here's what I tailored for ${where}:`, list, foot }
    : { intro: `Your tailored resume and cover letter for ${where} are ready.`, list: [], foot };
}

/** The message as stored: intro, a bulleted list, the footnote. */
export function summaryText({ intro, list, foot }: TailoringSummary): string {
  return [intro, list.length > 0 ? list.map((line) => `- ${line}`).join("\n") : null, foot].filter(Boolean).join("\n\n");
}
