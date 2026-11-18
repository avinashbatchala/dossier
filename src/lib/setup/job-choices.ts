import type { PortalView } from "@/lib/job-search/sources";

import { WIKI, type Instruction } from "./instructions";

// The setup guide's job search step (E21-3, E22-9): where the user looks
// and for what kind of work, then the portals that cover it, several at
// once. Until the market's catalog (E23-4) these are the built-ins.

export type JobKind = "tech" | "any" | "none";

export const JOB_KINDS: readonly { value: JobKind; name: string; description: string }[] = [
  { value: "tech", name: "Mostly tech", description: "Software, design, data and other roles at tech companies." },
  { value: "any", name: "Any kind of job", description: "Every field, from the big job sites. Most need a free key, which takes a few minutes to get." },
  { value: "none", name: "None for now", description: "You'll paste the postings you find yourself. Positions stays off until you switch on a portal in Settings." },
];

/** "Remote, anywhere": only the portals that list jobs in every country. */
export const ANYWHERE = "anywhere";

/** How to set up a built-in portal, in the guide. */
export type PortalGuide = { about: string; cost: string; steps: readonly Instruction[] };

export const PORTAL_GUIDES: Readonly<Record<string, PortalGuide>> = {
  FREEHIRE: {
    about: "Postings read straight from companies' own career pages, mostly tech, in most countries, with their whole text.",
    cost: "Free for personal use, with no key.",
    steps: [],
  },
  ADZUNA: {
    about: "Adzuna's own job index in 19 countries. It shares the start of each posting, and Dossier reads the rest from the posting's page.",
    cost: "A free key, with no card. Your account shows how many searches it allows.",
    steps: [
      {
        text: "Sign up as an Adzuna developer. The form asks for an organisation and a website: pick **Personal job search** as what you'll use it for, and enter a page of your own, such as your LinkedIn profile.",
        link: { href: "https://developer.adzuna.com/signup", label: "Adzuna's sign-up" },
      },
      { text: "Your account shows an application ID and a key. Copy both below." },
    ],
  },
  JSEARCH: {
    about: "Postings from LinkedIn, Indeed, Glassdoor and company sites, through Google for Jobs, in most countries.",
    cost: "A free plan with a small number of searches each month, and no card. Its page shows how many.",
    steps: [
      { text: "Sign up on OpenWeb Ninja's developer portal and choose JSearch's free plan.", link: { href: "https://app.openwebninja.com", label: "OpenWeb Ninja" } },
      { text: "Copy your API key and paste it below." },
    ],
  },
  ARBEITSAGENTUR: {
    about: "Germany's Federal Employment Agency: every kind of job in Germany, from its own job board.",
    cost: "Free, with no key. It has no official API, so it's your choice, after its note.",
    steps: [],
  },
};

/** How to set up a portal: a built-in's own guide, or what an added portal says about itself (E23-3). */
export const guideFor = (portal: Pick<PortalView, "id" | "description" | "tag">): PortalGuide => PORTAL_GUIDES[portal.id] ?? { about: portal.description, cost: portal.tag, steps: [] };

/** Whether a portal needs a key of the user's own. */
export const needsKey = (portal: Pick<PortalView, "fields">) => portal.fields.some((field) => field.type === "secret");

/** The portals that list jobs where the user looks: in their country, or in every country for remote anywhere. */
export function portalsFor<T extends { countries: readonly string[] | null }>(portals: readonly T[], where: string): T[] {
  return portals.filter((portal) => portal.countries === null || (where !== ANYWHERE && portal.countries.includes(where)));
}

/** Whether a portal starts ticked: free, with no note to accept, and for the kind of work asked. */
export function startsTicked(portal: Pick<PortalView, "fields" | "consent" | "kinds">, kind: JobKind): boolean {
  return !needsKey(portal) && portal.consent === null && portal.kinds.includes(kind);
}

export const JOB_SOURCES_HELP = `${WIKI}/Choosing-a-job-source`;
