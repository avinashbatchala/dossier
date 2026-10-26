import type { ProfileData } from "@/lib/profile";

import { reach, type Place } from "./place";
import { headerParts } from "./text";
import type { FoundStartup } from "./types";

// How well a startup fits the profile (#222), 0–100, with the reasons,
// worked out in code, so it needs no AI model and costs nothing: the
// profile's skills in what the startup does or asks for, the kind of work,
// whether it hires where the profile is (or remotely, open to its country),
// how fresh the post is, and whether there's an address to apply to.

export const MATCH_VERSION = "match@1";

/** Skills too general to say anything about a fit. */
const GENERIC = /^(agile|scrum|kanban|git|github|gitlab|jira|confluence|slack|ci\/cd( pipelines)?|communication|teamwork|leadership|problem solving|ms office|microsoft office|excel|english)$/i;

/** Kinds of work, recognised in the profile and in a startup's text. */
const FIELDS: { name: string; profile: RegExp; startup: RegExp }[] = [
  { name: "mobile", profile: /\b(android|ios|kotlin|swift|jetpack compose|react native|flutter|mobile)\b/i, startup: /\b(android|ios|mobile|kotlin|swift|react native|flutter|mobile app)\b/i },
  { name: "frontend", profile: /\b(react|next\.?js|vue|angular|svelte|typescript|frontend|front-end)\b/i, startup: /\b(frontend|front-end|react|next\.?js|vue|angular|svelte|web app)\b/i },
  { name: "backend", profile: /\b(node\.?js|express|django|rails|spring|golang|rust|postgres|mongodb|backend|back-end|graphql)\b/i, startup: /\b(backend|back-end|node\.?js|api|platform engineer|distributed systems|golang|rust)\b/i },
  { name: "infrastructure", profile: /\b(devops|sre|kubernetes|terraform|aws|gcp|azure|infrastructure)\b/i, startup: /\b(devops|sre|site reliability|kubernetes|infrastructure|platform)\b/i },
  { name: "data and AI", profile: /\b(python|machine learning|ml|pytorch|tensorflow|data science|llm|nlp)\b/i, startup: /\b(machine learning|ml engineer|ai engineer|data scientist|llm|nlp)\b/i },
  { name: "design", profile: /\b(figma|ux|ui design|product design|designer)\b/i, startup: /\b(designer|product design|ux|ui\/ux)\b/i },
  { name: "product", profile: /\b(product manager|product management|product owner)\b/i, startup: /\b(product manager|head of product|product lead)\b/i },
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A skill as a pattern that matches it as a word, e.g. "Node.js" also as "nodejs". */
function skillPattern(skill: string): RegExp {
  const spelled = escape(skill.toLowerCase()).replace(/\\\.(?=js\b)/, "\\.?").replace(/\s+/g, "[\\s-]?");
  return new RegExp(`(^|[^a-z0-9+#])${spelled}($|[^a-z0-9+#])`, "i");
}

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Where a startup says it hires: its location, and the title or the post's first line. */
export const whereText = (startup: Pick<FoundStartup, "source" | "location" | "summary" | "details">) =>
  [startup.location, startup.source === "YC" ? startup.summary : headerParts(startup.details).join(" | ")].join(" | ");

export type StartupFit = { score: number; reasons: string[] };

/** How well `startup` fits the profile, with the reasons in a few words each. */
export function matchStartup(
  startup: FoundStartup,
  profile: Pick<ProfileData, "basics" | "skills" | "experience">,
  place: Place,
  now = new Date(),
): StartupFit {
  const text = [startup.company, startup.summary, startup.details, startup.roles.join(" ")].join("\n");
  const reasons: string[] = [];
  let score = 10;

  // The profile's own skills in what the startup does or asks for.
  const skills = profile.skills.map((skill) => skill.name.trim()).filter((name) => name.length > 1 && !GENERIC.test(name));
  const hits = skills.filter((skill) => skillPattern(skill).test(text));
  score += Math.min(40, hits.slice(0, 2).length * 12 + hits.slice(2).length * 5);
  if (hits.length > 0) reasons.push(`Mentions ${list(hits.slice(0, 4))} from your skills`);

  // The kind of work the profile does.
  const profileText = [profile.basics.headline, profile.basics.summary, ...profile.experience.map((role) => role.role), ...skills].join(" ");
  const field = FIELDS.find((entry) => entry.profile.test(profileText) && entry.startup.test(text));
  if (field) {
    score += 15;
    reasons.push(`Hires for ${field.name} work, like yours`);
  } else if (/\b(engineer|developer|engineering)\b/i.test(text)) {
    score += 5;
  }

  // Where it hires.
  const where = reach(whereText(startup), place);
  if (where.here === "city") {
    score += 20;
    reasons.push(`In ${place.city}`);
  } else if (where.here === "country") {
    score += 12;
    reasons.push(`In ${place.countryName}`);
  }
  if (where.remote && where.remoteOpen === true) {
    score += 12;
    reasons.push(place.countryName ? `Remote, open to ${place.countryName}` : "Remote from anywhere");
  } else if (where.remote && where.remoteOpen === null) {
    score += 5;
    reasons.push("Remote (where from isn't said)");
  } else if (where.remote && where.remoteOnly) {
    reasons.push(`Remote only for ${where.remoteOnly}`);
  }

  // How fresh it is.
  const days = startup.postedAt ? (now.getTime() - Date.parse(startup.postedAt)) / 86_400_000 : Infinity;
  if (days <= 14) {
    score += 10;
    reasons.push(days < 1 ? "Posted today" : days < 2 ? "Posted yesterday" : `Posted ${Math.round(days)} days ago`);
  } else if (days <= 45) {
    score += 5;
  }

  if (startup.stage.startsWith("YC ")) {
    score += 5;
    reasons.push(`A ${startup.stage} startup`);
  }
  if (startup.emails.some((email) => email.label === "Hiring" || email.label === "Founders")) {
    score += 5;
    reasons.push("Publishes an address for applications");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
