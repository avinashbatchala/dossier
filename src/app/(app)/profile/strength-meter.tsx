"use client";

import { useId } from "react";

import { nextMissing, paidRoles, profileStrength, type ProfileData } from "@/lib/profile";

/** "Profile strength" with a progress bar and a hint that names the next missing thing (PRO-9, E33-1). */
export function StrengthMeter({ profile }: { profile: ProfileData }) {
  const labelId = useId();
  const hintId = useId();
  const strength = profileStrength({
    basics: profile.basics,
    experience: paidRoles(profile.experience).length,
    education: profile.education.length,
    skills: profile.skills.length,
  });
  const { percent } = strength;
  const next = nextMissing(profile);
  const hint = next ? `${percent >= 80 ? "Nearly there." : percent >= 50 ? "Good progress." : "A good start."} ${next}` : strength.hint;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-meta">
        <span id={labelId} className="text-muted">
          Profile strength
        </span>
        <span className="font-medium tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p id={hintId} className="text-label text-muted">
        {hint}
      </p>
    </div>
  );
}
