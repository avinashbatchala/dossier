/** How many tailored resumes there are, and how many of them use each role, by role id (E33-2). */
export type RoleUsage = { resumes: number; roles: Record<string, number> };

/** A tailored resume holds a role when it has its "experience:{id}" unit (see resume-content.ts). */
const ROLE_UNIT = "experience:";

/** Counts each role once per resume; units that aren't a list of parts are skipped. */
export function countRoleUsage(documents: readonly { units: unknown }[]): RoleUsage {
  const roles: Record<string, number> = {};
  for (const { units } of documents) {
    if (!Array.isArray(units)) continue;
    const ids = new Set<string>();
    for (const unit of units) {
      const id = typeof unit === "object" && unit !== null && "id" in unit ? unit.id : null;
      if (typeof id === "string" && id.startsWith(ROLE_UNIT)) ids.add(id.slice(ROLE_UNIT.length));
    }
    for (const id of ids) roles[id] = (roles[id] ?? 0) + 1;
  }
  return { resumes: documents.length, roles };
}

const resumes = (count: number) => (count === 1 ? "1 resume" : `${count} resumes`);

/** On an open role (E33-2): "Used in 6 of 7 resumes", "Not used in a resume yet", or null before the first tailored resume. */
export function roleUsageLabel(usage: RoleUsage, roleId: string): string | null {
  if (usage.resumes === 0) return null;
  const used = usage.roles[roleId] ?? 0;
  return used === 0 ? "Not used in a resume yet" : `Used in ${used} of ${resumes(usage.resumes)}`;
}

/** On a closed role (E33-2): "3 lines · used in 5 resumes"; the usage is left out before the first tailored resume. */
export function roleLinesNote(usage: RoleUsage, roleId: string, bullets: string): string {
  const count = bullets.split("\n").filter((line) => line.trim()).length;
  const lines = count === 1 ? "1 line" : `${count} lines`;
  if (usage.resumes === 0) return lines;
  const used = usage.roles[roleId] ?? 0;
  return `${lines} · ${used === 0 ? "not used in a resume yet" : `used in ${resumes(used)}`}`;
}
