// The top bar takes its colours from the page below it, so the two read as one
// surface, whichever scheme the page is in and whichever version of Dossier the
// server runs.

export type BarColors = { background: string; ink: string };

/** What the page's own colours are, read from inside it. */
export const READ_PAGE_COLORS = `(() => {
  const style = getComputedStyle(document.body);
  return { background: style.backgroundColor, ink: style.color };
})()`;

/** "rgb(238, 235, 228)" as "#eeebe4"; null for anything else, or a colour with no opaque background. */
export function toHex(color: unknown): string | null {
  if (typeof color !== "string") return null;
  const match = color.match(/^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!match) return null;
  if (match[4] !== undefined && parseFloat(match[4]) < 1) return null;
  const channels = match.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The app's own colours, for before a page has loaded, or a page with no background of its own. */
export const fallbackColors = (dark: boolean): BarColors => (dark ? { background: "#1a1917", ink: "#f0ede7" } : { background: "#eeebe4", ink: "#1d1c1a" });

/** The bar's colours for what a page answered. It comes from the server, so only colours are taken from it. */
export function barColors(answer: unknown, dark: boolean): BarColors {
  const { background, ink } = (typeof answer === "object" && answer !== null ? answer : {}) as Record<string, unknown>;
  const opaque = toHex(background);
  const text = toHex(ink);
  return opaque && text ? { background: opaque, ink: text } : fallbackColors(dark);
}
