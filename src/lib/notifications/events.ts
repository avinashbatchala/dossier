// Notifications (E26-1, #416): every event Dossier reports, each one entry
// here. An entry says what the grid calls it, whether it's on until the user
// says otherwise, and how it builds its message: a title, a short text, a
// link and, for webhooks, the event's data. To add an event: add it here,
// then call emit(<name>, data) where it happens (src/lib/notifications/notify.ts).
// No message ever carries profile content, documents, posting descriptions,
// mail content or keys.

/** What a message says, whichever channel it goes to; `path` is a page of Dossier's, `url` an address elsewhere. */
export type NotificationMessage = { title: string; text: string; path: string | null; url?: string | null };

/** A posting as a message names it. */
export type PostingLine = { title: string; company: string; /** Requirements covered (E32-2); null for none. */ coverage: { hit: number; total: number } | null; profile: string };

export type EventData = {
  /** A scheduled agent run finished (E26-4). */
  "agent.run.finished": {
    newCount: number;
    /** Each search: how many were new, and the best of them. */
    searches: { name: string; newCount: number; best: PostingLine | null }[];
    /** The portals that failed, with why. */
    failed: { portal: string; why: string }[];
    /** Every new posting, for webhooks only. */
    postings: { title: string; company: string; place: string; url: string; portals: string[]; scores: { profile: string; score: number }[] }[];
    /** Positions, filtered to the run. */
    path: string;
  };
  /** A portal in use was withdrawn from the catalog, and paused (E26-5). */
  "portal.withdrawn": { portal: string; why: string };
  /** The catalog has an update for a portal in use (E26-5). */
  "portal.updated": { portal: string; changes: string[]; newHosts: string[] };
  /** The agent wrote a draft with auto-draft (E26-6). */
  "draft.ready": { applicationId: string; title: string; company: string; coverage: { hit: number; total: number } | null };
  /** New application finished writing an application's documents (E31-4): which ones, never what they say. */
  "documents.written": { applicationId: string; title: string; company: string; resume: boolean; letter: boolean };
  /** The scheduled Gmail check found a reply (E26-6): who, about which application, never what it says. */
  "reply.arrived": { applicationId: string; from: string; title: string; company: string };
  /** An interview tomorrow (E26-7). */
  "interview.tomorrow": { applicationId: string; title: string; company: string; time: string };
  /** Applications with no news for a while (E26-7). */
  "followup.due": { applications: { id: string; title: string; company: string; days: number }[] };
  /** A new version of Dossier (E26-7). */
  "version.new": { version: string; url: string };
};

export type EventName = keyof EventData;

export type EventDefinition<N extends EventName> = {
  /** Its row in the grid. */
  label: string;
  hint: string;
  /** On for a channel until the user switches it. */
  on: boolean;
  message: (data: EventData[N]) => NotificationMessage;
  /** For "Only when there's something new": whether there is. Events without it always have something. */
  hasNews?: (data: EventData[N]) => boolean;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const postingLine = (posting: PostingLine) =>
  `${posting.title}${posting.company ? ` at ${posting.company}` : ""}${posting.coverage ? `, covers ${posting.coverage.hit} of ${posting.coverage.total}` : ""}${posting.profile ? ` (${posting.profile})` : ""}`;

/** Every event, in the grid's order. */
export const EVENTS: { [N in EventName]: EventDefinition<N> } = {
  "agent.run.finished": {
    label: "Agent run finished",
    hint: "After each scheduled run: what's new for each search, and the portals that failed.",
    on: true,
    hasNews: (data) => data.newCount > 0 || data.failed.length > 0,
    message: (data) => ({
      title: `Agent run finished · ${plural(data.newCount, "new posting", "new postings")}`,
      text: [
        ...data.searches.map((search) => `${search.name}: ${search.newCount} new${search.best ? ` · best ${postingLine(search.best)}` : ""}`),
        ...(data.failed.length > 0 ? [`${plural(data.failed.length, "portal", "portals")} failed: ${data.failed.map((entry) => `${entry.portal} (${entry.why})`).join(", ")}`] : []),
      ].join("\n"),
      path: data.path,
    }),
  },
  "portal.withdrawn": {
    label: "A portal you use was withdrawn",
    hint: "The catalog took it back. It's paused until you look at it.",
    on: true,
    message: (data) => ({
      title: `${data.portal} was withdrawn`,
      text: `${data.why} It's paused: Dossier won't search it until you look at it in Settings → Job search.`,
      path: "/settings?section=jobs",
    }),
  },
  "portal.updated": {
    label: "An update for a portal you use",
    hint: "The catalog has a newer version of it.",
    on: false,
    message: (data) => ({
      title: `An update for ${data.portal}`,
      text: [...data.changes, ...(data.newHosts.length > 0 ? [`It would also reach ${data.newHosts.join(", ")}.`] : [])].join("\n") || "A newer version is in the catalog.",
      path: "/settings?section=jobs",
    }),
  },
  "draft.ready": {
    label: "A draft is ready",
    hint: "When the job agent prepares a draft on its own. Prepare draft never sends it.",
    on: false,
    message: (data) => ({
      title: `A draft is ready: ${data.title}`,
      text: `The job agent prepared a draft for ${data.title}${data.company ? ` at ${data.company}` : ""}${data.coverage ? `, which covers ${data.coverage.hit} of ${data.coverage.total} requirements` : ""}. It waits for your review.`,
      path: "/agent",
    }),
  },
  "documents.written": {
    label: "Documents written",
    hint: "When New application has written the resume and cover letter you asked for. You can leave the page while it writes.",
    on: true,
    message: (data) => ({
      title: `${data.resume && data.letter ? "Your resume and cover letter are" : data.letter ? "Your cover letter is" : "Your resume is"} ready`,
      text: `For ${data.title}${data.company ? ` at ${data.company}` : ""}. Nothing is sent until you say so.`,
      path: `/applications/${data.applicationId}`,
    }),
  },
  "reply.arrived": {
    label: "A reply arrived",
    hint: "When the Gmail check finds a reply: who, about which application, never what it says.",
    on: false,
    message: (data) => ({
      title: `A reply from ${data.from}`,
      text: `About ${data.title}${data.company ? ` at ${data.company}` : ""}.`,
      path: `/applications/${data.applicationId}?tab=email`,
    }),
  },
  "interview.tomorrow": {
    label: "An interview tomorrow",
    hint: "At 18:00 the evening before, in your time zone.",
    on: false,
    message: (data) => ({
      title: `Interview tomorrow at ${data.time}`,
      text: `${data.title}${data.company ? ` at ${data.company}` : ""}.`,
      path: `/applications/${data.applicationId}`,
    }),
  },
  "followup.due": {
    label: "A follow-up is due",
    hint: "Applications with no news for a while, as the dashboard counts them.",
    on: false,
    message: (data) => ({
      title: `${plural(data.applications.length, "application has", "applications have")} had no news for a while`,
      text: data.applications.map((application) => `${application.title}${application.company ? ` at ${application.company}` : ""}: ${plural(application.days, "day", "days")}`).join("\n"),
      path: "/applications",
    }),
  },
  "version.new": {
    label: "A new Dossier version",
    hint: "Once per version, while Check for updates daily is on.",
    on: false,
    message: (data) => ({ title: `Dossier ${data.version} is out`, text: "See what's new, and how to upgrade.", path: null, url: data.url }),
  },
};

export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];

/** Whether an event is on for a channel: its own choice, else the event's default. */
export const eventOn = (events: Readonly<Record<string, boolean>>, name: EventName) => events[name] ?? EVENTS[name].on;

/** Send a test's message (E26-2). */
export const testMessage = (channel: string): NotificationMessage => ({
  title: "A test from Dossier",
  text: `If you can read this, notifications to “${channel}” work.`,
  path: "/settings?section=notifications",
});
