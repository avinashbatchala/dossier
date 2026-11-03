import "server-only";

import { prisma } from "@/lib/prisma";

// Helpers for adding to the profile's lists, shared by the profile editor
// and the application page ("+ Add to profile").

/** The next `sort` value, so new entries go last. */
export async function nextSort(model: {
  aggregate: (args: { _max: { sort: true } }) => Promise<{ _max: { sort: number | null } }>;
}) {
  const { _max } = await model.aggregate({ _max: { sort: true } });
  return (_max.sort ?? -1) + 1;
}

/** A `sort` value before all others, so a new entry goes first (E4-9). */
export async function firstSort(model: {
  aggregate: (args: { _min: { sort: true } }) => Promise<{ _min: { sort: number | null } }>;
}) {
  const { _min } = await model.aggregate({ _min: { sort: true } });
  return (_min.sort ?? 1) - 1;
}

/** Finds a skill by name, ignoring case (citext), or creates it. */
export async function findOrCreateSkill(name: string, group?: string) {
  const existing = await prisma.skill.findUnique({ where: { name } });
  if (existing) {
    // Added under a group in Profile → Skills, it moves there (#280).
    const skill = group !== undefined && group !== existing.group ? await prisma.skill.update({ where: { id: existing.id }, data: { group } }) : existing;
    return { skill: { id: skill.id, name: skill.name, group: skill.group }, added: false };
  }
  const created = await prisma.skill.create({ data: { name, group: group ?? "", sort: await nextSort(prisma.skill) } });
  return { skill: { id: created.id, name: created.name, group: created.group }, added: true };
}
