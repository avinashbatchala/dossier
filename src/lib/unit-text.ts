// The text of a tailored document's unit, as saved.

/** Bullet characters a model may add even when asked not to, and people type out of habit. */
const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;

/** A role's or project's bullets are one per line, without bullet characters or empty lines. */
export function bulletLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(BULLET, "").trim())
    .filter(Boolean)
    .join("\n");
}

/** Whether a unit holds a role or a project, whose text is a list of bullets. */
export function isBulletUnit(unitId: string): boolean {
  return unitId.startsWith("experience:") || unitId.startsWith("project:");
}

/** Whether a unit holds a publication (#218): the user's citation, which the AI never rewrites. */
export function isPublicationUnit(unitId: string): boolean {
  return unitId.startsWith("publication:");
}

/** Text for a unit as written in the editor: a role's or project's bullets cleaned up, anything else trimmed. */
export function cleanUnitText(unitId: string, text: string): string {
  return isBulletUnit(unitId) ? bulletLines(text) : text.trim();
}

/**
 * How a unit is called in a sentence, after "the": "summary", "opening
 * paragraph", or a role's, project's, degree's or publication's own name, e.g. "Northwind Logistics role".
 */
export function unitName(unit: { id: string; label: string }): string {
  const label = unit.label.trim();
  if (["experience:", "project:", "education:", "publication:"].some((prefix) => unit.id.startsWith(prefix))) return label || "entry";
  if (unit.id.startsWith("paragraph:")) {
    const name = label.toLowerCase() || "paragraph";
    return /\bparagraph$/.test(name) ? name : `${name} paragraph`;
  }
  return label.toLowerCase() || "part";
}
