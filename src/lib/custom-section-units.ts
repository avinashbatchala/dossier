import type { Unit } from "@/lib/application-data";
import { citationExcerpt } from "@/lib/citation";
import type { CustomSection } from "@/lib/profile";

// A custom section's parts on a tailored resume (#298), word for word:
// an entry's unit holds its bullets, with its title and dates read from the
// item, as a role's are. A line's holds the line itself. An inline section
// is one part, an item per line, since its items share a line on the page.

/** The parts of a section with only what resumes show (`resumeCustomSections`). */
export function customSectionUnits(section: CustomSection): Unit[] {
  const title = section.title.trim();
  switch (section.format) {
    case "ENTRIES":
      return section.items.map((item) => ({ id: `custom-entry:${item.id}`, label: item.title.trim() || title, text: item.details.trim() }));
    case "LINES":
      return section.items.map((item) => ({ id: `custom-line:${item.id}`, label: citationExcerpt(item.title) || title, text: item.title.trim() }));
    case "INLINE":
      return [{ id: `custom-inline:${section.id}`, label: title, text: section.items.map((item) => item.title.trim()).join("\n") }];
  }
}

/** The ids a section's parts can have, in any format: for finding them after its format changed. */
export function customSectionUnitIds(section: CustomSection): string[] {
  return [`custom-inline:${section.id}`, ...section.items.flatMap((item) => [`custom-entry:${item.id}`, `custom-line:${item.id}`])];
}
