"use client";

import { FactList } from "@/components/fact-list";
import type { ProfileData } from "@/lib/profile";

import type { UpdateProfile } from "./skills-section";

/**
 * Facts about me (PRO-14): things only the user can say, such as why they're
 * changing careers or when they can start. Given to the AI with the profile.
 */
export function FactsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return (
    <FactList
      applicationId={null}
      facts={profile.facts}
      setFacts={(change) => update((current) => ({ ...current, facts: change(current.facts) }))}
      placeholder="e.g. I'm moving from teaching into UX research. Or: I have an EU work permit and can start in March."
    />
  );
}
