// The tabs of an application's page, kept in the URL as ?tab=… (APP-3).

export const TABS = ["resume", "letter", "email", "conversation", "posting", "notes"] as const;
export type Tab = (typeof TABS)[number];

/** The tab a ?tab= value asks for; the resume when it's missing or unknown. */
export function tabFrom(value: string | string[] | undefined): Tab {
  return TABS.find((tab) => tab === value) ?? "resume";
}

/** "about 280 words": the letter's paragraphs, to the nearest ten once there are a few. */
export function aboutWords(paragraphs: string[]): string {
  const words = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
  const about = words < 20 ? words : Math.round(words / 10) * 10;
  return `about ${about} ${about === 1 ? "word" : "words"}`;
}
