"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Saved here, from an environment variable, missing, or saved under another DOSSIER_SECRET. */
export type KeyState = "none" | "set" | "unreadable" | "env";

export const KEY_UNREADABLE = "Your saved key can't be read. Please enter it again.";

/**
 * A write-only key (Settings → Job search, Scoring): saved when you leave
 * the field or press Enter, then only "Saved" shows.
 */
export function KeyField({
  label,
  keyState,
  envName,
  getKey,
  onSave,
}: {
  label: string;
  keyState: KeyState;
  envName: string;
  getKey: { href: string; text: string };
  onSave: (change: { action: "set"; value: string } | { action: "clear" }) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const save = async () => {
    if (!value.trim()) return;
    if (await onSave({ action: "set", value })) setValue("");
  };
  return (
    <div className="flex flex-col gap-2.5">
      <Input
        label={label}
        type="password"
        autoComplete="off"
        value={value}
        placeholder={
          keyState === "set" ? "Saved · type a new key to replace it" : keyState === "env" ? `Using ${envName} · type one to save it here` : "Stored encrypted on your server"
        }
        error={keyState === "unreadable" ? KEY_UNREADABLE : undefined}
        hint={
          keyState === "none" ? (
            <>
              Get one from{" "}
              <a href={getKey.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                {getKey.text}
              </a>
              .
            </>
          ) : undefined
        }
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim()) {
            event.preventDefault();
            void save();
          }
        }}
      />
      {(keyState === "set" || keyState === "unreadable") && (
        <Button variant="text" size="sm" className="self-start" onClick={() => void onSave({ action: "clear" })}>
          Remove saved key
        </Button>
      )}
    </div>
  );
}
