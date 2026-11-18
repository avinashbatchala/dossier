// Marking a change where it lands (E30-12, AP4): units are a whole role or
// section, so a line diff inside the changed unit picks the lines to mark.

/** A line as it reads on the page: without its bullet, its spacing evened out. */
export const lineText = (line: string) => line.replace(/^\s*(?:[-•*·]\s+)?/, "").replace(/\s+/g, " ").trim();

/**
 * The lines of `after` that weren't in `before`, as they read on the page;
 * null when every line changed (or there's only one), so the whole unit is
 * marked instead.
 */
export function changedLines(before: string, after: string): string[] | null {
  const old = new Set(before.split("\n").map(lineText).filter(Boolean));
  const lines = after.split("\n").map(lineText).filter(Boolean);
  const changed = lines.filter((line) => !old.has(line));
  if (lines.length <= 1 || changed.length === lines.length) return null;
  // Only moved: mark the line that moved up.
  if (changed.length === 0) {
    const was = before.split("\n").map(lineText).filter(Boolean);
    const moved = lines.find((line, index) => was.indexOf(line) > index);
    return moved ? [moved] : null;
  }
  return changed;
}
