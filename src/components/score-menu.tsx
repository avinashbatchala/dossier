"use client";

import type { ReactNode } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Score's button (E25-5): with several profiles it opens a menu that asks
 * which to score against, one or all of them; with one it's the button
 * itself. Positions and Startups (#524) share it.
 */
export function ScoreMenu({ profiles, disabled, onScore, children }: { profiles: readonly { id: string; name: string }[]; disabled: boolean; onScore: (profiles?: string) => void; children: ReactNode }) {
  if (profiles.length <= 1) return children;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Score against</DropdownMenuLabel>
        {profiles.map((profile) => (
          <DropdownMenuItem key={profile.id} onSelect={() => onScore(profile.id)}>
            {profile.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => onScore("all")}>All profiles</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
