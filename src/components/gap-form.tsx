"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";

/** What a gap's "Add to profile" sends (E30-5): the role it was used in, and what was done there. */
export type GapAnswer = { experienceId: string | null; did: string };

/**
 * Adding a gap's skill to the profile (E30-5, design 4g): where it was used
 * and, optionally, what was done there, which becomes a line in that role.
 * Or "I don't have this". Esc closes it.
 */
export function GapForm({
  skill,
  roles,
  onAdd,
  onKnown,
  onCancel,
  className,
}: {
  skill: string;
  roles: readonly { id: string; label: string }[];
  onAdd: (answer: GapAnswer) => Promise<void>;
  onKnown: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const [role, setRole] = useState(roles[0]?.id ?? "");
  const [did, setDid] = useState("");
  const [pending, startTransition] = useTransition();
  const add = () => startTransition(() => onAdd({ experienceId: role || null, did: role ? did.trim() : "" }));
  return (
    <div
      role="group"
      aria-label={`Add ${skill} to your profile`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      className={cn("flex flex-col gap-3 border-t border-line pt-3", className)}
    >
      <p className="text-meta text-muted">Only add it if it&apos;s true. Dossier will use it from here on.</p>
      <Select label="Where you used it" value={role} onChange={(event) => setRole(event.target.value)} autoFocus>
        {roles.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
        <option value="">Not in a role, only my skills</option>
      </Select>
      {role && (
        <Textarea
          label={
            <>
              What you did with it <span className="font-normal text-muted">· optional</span>
            </>
          }
          rows={3}
          maxLength={500}
          value={did}
          onChange={(event) => setDid(event.target.value)}
          placeholder={`e.g. Set up ${skill} for the team's deploys`}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" aria-disabled={pending || undefined} onClick={() => !pending && add()}>
          Add to profile
        </Button>
        <Button variant="text" size="sm" onClick={onKnown}>
          I don&apos;t have this
        </Button>
      </div>
    </div>
  );
}
