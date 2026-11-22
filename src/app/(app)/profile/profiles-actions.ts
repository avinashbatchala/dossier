"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { AiError, getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { guessLevels } from "@/lib/ai/tasks";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { loadProfile } from "@/lib/profile-data";
import { levelRangeSchema } from "@/lib/profile-levels";
import { workplaceSchema } from "@/lib/profile-workplace";
import { copyProfile, createProfile, deleteProfile, firstProfileId, markWorkplaceSeen, openProfileId, renameProfile, saveProfileLevels, saveProfileWorkplace } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";

// Making, switching and managing profiles (E24-2, #403). Each is a resume of
// its own; the basics, languages and facts are shared.

const id = z.string().min(1);
const name = z.string().trim().min(1, "Give the profile a name.").max(60, "Keep a profile's name under 60 characters.");

const GONE = "That profile no longer exists. Reload the page.";

const refresh = () => {
  revalidatePath("/profile");
  revalidatePath("/resume");
};

/**
 * New profile: empty, a copy of another, or empty and then read from a
 * resume file (the browser goes on to the import). It becomes the open one.
 */
export const newProfile = action(
  z.discriminatedUnion("start", [
    // An empty profile says which levels it's for from the start (E24-3); a copy has its original's, and one read from a file gets the import's guess.
    z.object({ start: z.literal("empty"), name, levels: levelRangeSchema }),
    z.object({ start: z.literal("file"), name }),
    z.object({ start: z.literal("copy"), name, from: id }),
  ]),
  async (input, { toast }) => {
    if (input.start === "copy" && !(await prisma.profile.count({ where: { id: input.from } }))) throw new ActionError(GONE);
    const created = input.start === "copy" ? await copyProfile(input.from, input.name) : await createProfile(input.name, input.start === "empty" ? input.levels : null);
    await openProfileId(created);
    refresh();
    if (input.start !== "file") toast(`Made “${input.name}”.`);
    return { id: created };
  },
);

/** Renames a profile. */
export const renameProfileAction = action(z.object({ id, name }), async ({ id: profileId, name: newName }) => {
  if (!(await renameProfile(profileId, newName))) throw new ActionError(GONE);
  refresh();
  return null;
});

/**
 * Deletes a profile with its sections and Base resume, once confirmed. The
 * last one can't go. Answers with the profile that opens instead.
 */
export const deleteProfileAction = action(z.object({ id }), async ({ id: profileId }, { toast }) => {
  const name = (await prisma.profile.findUnique({ where: { id: profileId }, select: { name: true } }))?.name;
  const result = await deleteProfile(profileId);
  if (result === "gone") throw new ActionError(GONE);
  if (result === "last") throw new ActionError("That's your only profile. Make another before deleting this one.");
  const next = await firstProfileId();
  await openProfileId(next);
  refresh();
  toast(`Deleted “${name}”.`);
  return { id: next };
});

/** The levels a profile is for (E24-3), as the user picks them. */
export const setProfileLevels = action(z.object({ profileId: id, levels: levelRangeSchema }), async ({ profileId, levels }) => {
  if (!(await saveProfileLevels(profileId, levels))) throw new ActionError(GONE);
  refresh();
  return levels;
});

/**
 * "Guess with AI" (E24-3): the levels the profile's roles point to, saved,
 * so the picker shows them; the user can change them.
 */
export const guessProfileLevels = action(z.object({ profileId: id }), async ({ profileId }) => {
  if (!(await prisma.profile.count({ where: { id: profileId } }))) throw new ActionError(GONE);
  if (!(await isAiUsable())) throw new ActionError("Set up an AI model in Settings → AI provider first, or pick the levels yourself.");
  const profile = await loadProfile(profileId);
  if (!profile.experience.some((role) => role.role.trim())) throw new ActionError("Add a role or two to this profile first: the guess comes from them.");
  try {
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
    const { data } = await guessLevels(provider, { profile }, options);
    await saveProfileLevels(profileId, data);
    refresh();
    return data;
  } catch (error) {
    if (error instanceof AiError) throw new ActionError(error.message);
    throw error;
  }
});

/** Where a profile wants to work (E24-4), saved as the user changes it. */
export const setProfileWorkplace = action(z.object({ profileId: id, workplace: workplaceSchema }), async ({ profileId, workplace }) => {
  if (!(await saveProfileWorkplace(profileId, workplace))) throw new ActionError(GONE);
  revalidatePath("/profile");
  return null;
});

/** The user has looked at where the profile wants to work (E24-4): the Profile page stops asking. */
export const sawProfileWorkplace = action(z.object({ profileId: id }), async ({ profileId }) => {
  await markWorkplaceSeen(profileId);
  return null;
});
