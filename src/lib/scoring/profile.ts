import "server-only";

import { AiError } from "@/lib/ai/errors";
import type { ProfileData } from "@/lib/profile";
import { loadProfile } from "@/lib/profile-data";
import { levelsProblem, loadProfileLevels, loadProfileWorkplace, profileIdOr } from "@/lib/profiles";

import type { ScoringProfile } from "./questions";

/**
 * A profile as scoring models read it (E25-1): its sections (or `data`, such
 * as a tailored resume read as a profile), the levels it's for and where it
 * wants to work; the first profile when `profileId` is missing or gone.
 * Fails as an AiError while its levels aren't chosen: nothing guesses them.
 */
export async function loadScoringProfile(profileId?: string | null, data?: ProfileData): Promise<ScoringProfile> {
  const id = await profileIdOr(profileId);
  const [levels, { workplace }, profile] = await Promise.all([loadProfileLevels(id), loadProfileWorkplace(id), data ?? loadProfile(id)]);
  if (!levels) {
    const problem = await levelsProblem(id);
    throw AiError.config(`${problem?.message ?? "Set this profile's levels first."} Choose them in Profile → Jobs it's for.`);
  }
  return { data: profile, levels, workplace };
}
