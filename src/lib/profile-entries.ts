import "server-only";

import { prisma } from "@/lib/prisma";

// Helpers for adding to a profile's lists, shared by the profile editor and
// the application page ("+ Add to profile"). Each list is one profile's
// (E24-1): `where` keeps a sort value to that profile's entries.

/** A table with a `sort` column: a method, so any of Prisma's model delegates fits. */
type Sortable = { aggregate(args: object): PromiseLike<unknown> };

/** The next `sort` value, so new entries go last. */
export async function nextSort(model: Sortable, where?: object) {
  const { _max } = (await model.aggregate({ where, _max: { sort: true } })) as { _max: { sort: number | null } };
  return (_max.sort ?? -1) + 1;
}

/** A `sort` value before all others, so a new entry goes first (E4-9). */
export async function firstSort(model: Sortable, where?: object) {
  const { _min } = (await model.aggregate({ where, _min: { sort: true } })) as { _min: { sort: number | null } };
  return (_min.sort ?? 1) - 1;
}

/** Finds a skill of the profile by name, ignoring case (citext), or creates it there. */
export async function findOrCreateSkill(profileId: string, name: string, group?: string) {
  const existing = await prisma.skill.findUnique({ where: { profileId_name: { profileId, name } } });
  if (existing) {
    // Added under a group in Profile → Skills, it moves there (#280).
    const skill = group !== undefined && group !== existing.group ? await prisma.skill.update({ where: { id: existing.id }, data: { group } }) : existing;
    return { skill: { id: skill.id, name: skill.name, group: skill.group }, added: false };
  }
  const created = await prisma.skill.create({ data: { profileId, name, group: group ?? "", sort: await nextSort(prisma.skill, { profileId }) } });
  return { skill: { id: created.id, name: created.name, group: created.group }, added: true };
}
