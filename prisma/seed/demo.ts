import type { PrismaClient } from "@/generated/prisma/client";
import { ApplicationStatus } from "@/generated/prisma/enums";
import {
  extractedSchema,
  matchSchema,
  unitsSchema,
  type Match,
} from "@/lib/application-data";
import { dateSpan, demoLetterUnits, demoProfile, demoResumeUnits, LEVELS_BY_LABEL } from "@/lib/demo-profile";
import { basicsFromFields, fieldsFromBasics } from "@/lib/profile";
import { advance, type StatusFields } from "@/lib/status";

import sample from "./prototype-sample.json";

// The prototype's sample data (Jane Doe and her applications), for
// development and demos. It's only loaded with `prisma db seed -- --demo`.

const DAY = 86_400_000;
/** The prototype's "today"; its relative dates ("3 Oct", "sent 40 days ago") count from here. */
const PROTOTYPE_TODAY = Date.UTC(2026, 8, 27);

/** Thrown when demo data would replace the user's own data. */
export class DemoRefused extends Error {
  override name = "DemoRefused";
}

type Db = Pick<
  PrismaClient,
  | "$transaction"
  | "profileField"
  | "skill"
  | "language"
  | "experience"
  | "project"
  | "education"
  | "publication"
  | "reference"
  | "fact"
  | "application"
>;

/** A prototype date like "3 Oct" or "15 Oct 2026", moved to the same distance from `now`. */
function relativeDate(text: string, now: Date): Date {
  const [day, month, year = "2026"] = text.split(" ");
  const original = Date.parse(`${month} ${day}, ${year} UTC`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + (original - PROTOTYPE_TODAY));
}

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

/** The statuses an application passed through to reach its current one. */
function statusPath(status: string, reached?: string): ApplicationStatus[] {
  const stages: ApplicationStatus[] = ["SENT", "SCREENING", "INTERVIEW", "OFFER", "ACCEPTED"];
  const to = status.toUpperCase() as ApplicationStatus;
  if (to === "DRAFT") return [];
  const last = (reached?.toUpperCase() ?? to) as ApplicationStatus;
  const path = stages.slice(0, stages.indexOf(last) + 1);
  return path.at(-1) === to ? path : [...path, to];
}

/** Whether the database has anything of the user's that demo data would replace. */
export async function hasUserData(db: Db): Promise<boolean> {
  const [fields, ...counts] = await Promise.all([
    db.profileField.findMany(),
    db.skill.count(),
    db.language.count(),
    db.experience.count(),
    db.project.count(),
    db.education.count(),
    db.publication.count(),
    db.reference.count(),
    db.fact.count(),
    db.application.count(),
  ]);
  const basics = basicsFromFields(fields);
  const filledIn = [basics.name, basics.headline, basics.email, basics.summary].some(Boolean);
  return filledIn || counts.some((count) => count > 0);
}

/**
 * Loads the prototype's sample profile and nine applications. Refuses when
 * the database already has a profile or applications, unless `reset` is set:
 * then those are deleted first (themes and settings are kept).
 */
export async function seedDemo(
  db: Db,
  { now = new Date(), reset = false }: { now?: Date; reset?: boolean } = {},
): Promise<{ applications: number }> {
  if (!reset && (await hasUserData(db))) {
    throw new DemoRefused(
      "Demo data wasn't loaded: the database already has a profile or applications. " +
        "Run `docker/bin/yarn prisma db seed -- --demo --reset` to delete them and load the demo instead.",
    );
  }

  return db.$transaction(
    async (tx) => {
      if (reset) {
        await tx.application.deleteMany();
        await tx.skill.deleteMany();
        await tx.language.deleteMany();
        await tx.experience.deleteMany();
        await tx.project.deleteMany();
        await tx.education.deleteMany();
        await tx.publication.deleteMany();
        await tx.reference.deleteMany();
        await tx.fact.deleteMany();
      }

      // ── Profile ──
      const { experience, projects, education, publications, skills, languages, references, facts } = sample.profile;
      await tx.profileField.deleteMany();
      await tx.profileField.createMany({
        data: Object.entries(fieldsFromBasics(demoProfile().basics)).flatMap(([key, value]) =>
          value === null ? [] : [{ key, value }],
        ),
      });

      const skillIds = new Map<string, string>();
      for (const [sort, name] of skills.entries()) {
        const skill = await tx.skill.create({ data: { name, sort } });
        skillIds.set(name, skill.id);
      }
      await tx.language.createMany({
        data: languages.map(({ name, level }, sort) => ({ name, level: LEVELS_BY_LABEL.get(level)!, sort })),
      });

      const experienceIds = new Map<string, string>();
      for (const [sort, entry] of experience.entries()) {
        const created = await tx.experience.create({
          data: {
            role: entry.role,
            company: entry.company,
            location: entry.location,
            descriptor: entry.descriptor,
            bullets: entry.bullets,
            sort,
            ...dateSpan(entry.start, entry.end),
            skills: { create: entry.skills.map((name) => ({ skillId: skillIds.get(name)! })) },
          },
        });
        experienceIds.set(entry.id, created.id);
      }
      const projectIds = new Map<string, string>();
      for (const [sort, entry] of projects.entries()) {
        const created = await tx.project.create({
          data: {
            name: entry.name,
            link: entry.link,
            bullets: entry.bullets,
            sort,
            ...dateSpan(entry.start, entry.end),
            skills: { create: entry.skills.map((name) => ({ skillId: skillIds.get(name)! })) },
          },
        });
        projectIds.set(entry.id, created.id);
      }
      const educationIds = new Map<string, string>();
      for (const [sort, { id, degree, school, notes, start, end }] of education.entries()) {
        const created = await tx.education.create({
          data: { degree, school, notes, sort, ...dateSpan(start, end) },
        });
        educationIds.set(id, created.id);
      }
      const publicationIds = new Map<string, string>();
      for (const [sort, { id, citation, link }] of publications.entries()) {
        const created = await tx.publication.create({ data: { citation, link, sort } });
        publicationIds.set(id, created.id);
      }
      await tx.reference.createMany({
        data: references.map(({ name, relation, company, email, phone }, sort) => ({
          name,
          relation,
          company,
          email,
          phone,
          sort,
        })),
      });
      await tx.fact.createMany({ data: facts.map((text, sort) => ({ text, sort })) });

      // ── Applications ──
      const ledgerly = sample.ledgerly;
      const requirements = ledgerly.requirements;

      // Only the score of these is shown, so their match reuses the Ledgerly
      // requirements, covered up to the prototype's score (e.g. "5/7").
      const illustrativeMatch = (score: string): Match => {
        const hit = Number(score.split("/")[0]);
        return {
          items: requirements.map((requirement, index) => ({
            requirement: requirement.text,
            result: index < hit ? "covered" : "gap",
            skill: null,
            experienceIds: [],
            note: null,
          })),
        };
      };

      for (const app of sample.applications) {
        const updatedAt = daysBefore(now, app.daysAgo);
        const sentAt = app.sentAgo === undefined ? null : daysBefore(now, app.sentAgo);
        const path = statusPath(app.status, app.reached);

        // Replay the path through the status rules, so the history and the
        // funnel fields always agree; events are spread from sent to last update.
        let fields: StatusFields = { status: "DRAFT", furthestStage: null, sentAt: null };
        const events = path.map((to, index) => {
          const at =
            path.length === 1
              ? sentAt!
              : new Date(sentAt!.getTime() + ((updatedAt.getTime() - sentAt!.getTime()) * index) / (path.length - 1));
          const change = advance(fields, to, at)!;
          fields = change.update;
          return change.event;
        });

        await tx.application.create({
          data: {
            title: `${app.role} · ${app.company}`,
            company: app.company,
            role: app.role,
            location: app.location,
            mode: app.mode,
            salary: app.salary ?? "",
            deadline: app.deadline ? relativeDate(app.deadline, now) : null,
            // The next interview (E9-9): that many days from now, at noon UTC.
            nextInterviewAt:
              app.interviewIn === undefined
                ? null
                : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + app.interviewIn, 12)),
            match: matchSchema.parse(illustrativeMatch(app.match)),
            language: "English",
            ...fields,
            createdAt: sentAt ?? updatedAt,
            updatedAt,
            events: { create: events },
          },
        });
      }

      // Ledgerly: the draft from the new application flow, with its documents.
      const byExperience = (sampleIds: string[]) => sampleIds.map((id) => experienceIds.get(id)!);
      const match: Match = {
        items: requirements.map((requirement) => {
          const base = { requirement: requirement.text, skill: null, experienceIds: [] as string[], note: null };
          if ("years" in requirement) {
            const oldest = experience.at(-1)!;
            return {
              ...base,
              result: "covered" as const,
              experienceIds: byExperience(experience.map((entry) => entry.id)),
              note: `${experience.length} roles in your profile, since ${oldest.start}`,
            };
          }
          if ("skill" in requirement && requirement.skill) {
            const roles = experience.filter((entry) => entry.skills.includes(requirement.skill));
            if (roles.length > 0) {
              return {
                ...base,
                result: "covered" as const,
                skill: requirement.skill,
                experienceIds: byExperience(roles.map((entry) => entry.id)),
                note: `Used at ${roles.map((entry) => entry.company).join(", ")}`,
              };
            }
            return skills.includes(requirement.skill)
              ? { ...base, result: "partial" as const, skill: requirement.skill, note: "In your skills, but not linked to a role yet" }
              : { ...base, result: "gap" as const, skill: requirement.skill, note: "Not in your profile yet" };
          }
          if ("lang" in requirement && requirement.lang) {
            const language = languages.find((entry) => entry.name === requirement.lang);
            return language
              ? { ...base, result: "covered" as const, skill: language.name, note: `${language.name}: ${language.level}` }
              : { ...base, result: "gap" as const, note: "Not in your profile" };
          }
          return { ...base, result: "gap" as const, note: "none" in requirement ? (requirement.none ?? null) : null };
        }),
      };

      const resumeUnits = demoResumeUnits(
        (id) => experienceIds.get(id)!,
        (id) => educationIds.get(id)!,
        (id) => projectIds.get(id)!,
        (id) => publicationIds.get(id)!,
      );
      const letterUnits = demoLetterUnits();
      const extract = ledgerly.extract;

      await tx.application.create({
        data: {
          title: extract.title,
          company: extract.company,
          role: extract.role,
          location: extract.location,
          mode: extract.mode,
          salary: extract.salary,
          deadline: relativeDate(extract.deadline, now),
          postingText: ledgerly.posting,
          extracted: extractedSchema.parse({
            ...extract,
            deadline: relativeDate(extract.deadline, now).toISOString().slice(0, 10),
            requirements: requirements.map((requirement) => ({
              text: requirement.text,
              kind: "years" in requirement ? "years" : "skill" in requirement ? "skill" : "lang" in requirement ? "language" : "other",
              skill: "skill" in requirement ? (requirement.skill ?? null) : null,
              years: "years" in requirement ? Number(/\d+/.exec(requirement.text)?.[0] ?? 0) : null,
              language: "lang" in requirement ? (requirement.lang ?? null) : null,
            })),
            asksForReferences: false,
            language: "English",
          }),
          match: matchSchema.parse(match),
          language: "English",
          createdAt: now,
          updatedAt: now,
          facts: { create: ledgerly.facts.map((text, sort) => ({ text, sort })) },
          documents: {
            create: [
              { kind: "RESUME", units: unitsSchema.parse(resumeUnits), themeId: "editorial" },
              { kind: "COVER_LETTER", units: unitsSchema.parse(letterUnits), themeId: "editorial" },
            ],
          },
          messages: {
            create: {
              role: "AI",
              text: [ledgerly.chat.text, "", ...ledgerly.chat.list.map((line) => `- ${line}`), "", ledgerly.chat.foot].join("\n"),
              createdAt: now,
            },
          },
        },
      });

      return { applications: sample.applications.length + 1 };
    },
    { timeout: 30_000 },
  );
}
