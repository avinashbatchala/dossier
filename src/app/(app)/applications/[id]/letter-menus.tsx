"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Tone } from "@/generated/prisma/enums";
import { DOCUMENT_LANGUAGES } from "@/lib/document-language";
import { TONES } from "@/lib/tones";

const caret = (
  <span aria-hidden="true" className="text-[10px]">
    ▼
  </span>
);

/**
 * "Warm tone ▾" on the cover letter's toolbar (E30-9): another tone
 * rewrites the letter in it, through the writing job (AP3).
 */
export function ToneMenu({ tone, disabled, onChange }: { tone: Tone; disabled?: boolean; onChange: (tone: Tone) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="text" size="sm" aria-disabled={disabled || undefined} className="data-[state=open]:text-ink">
          {TONES[tone].label} tone
          {caret}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Rewrite the letter in a tone</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={tone} onValueChange={(value) => !disabled && value !== tone && onChange(value as Tone)}>
          {(Object.keys(TONES) as Tone[]).map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {TONES[value].label}
              {/* The space keeps the item's name readable: "Warm Personal and upbeat." */}{" "}
              <span className="text-meta text-muted">{TONES[value].description}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "English ▾" on the cover letter's toolbar (E30-9): the documents'
 * language. Another one rewrites the letter in it, through the writing job;
 * it doesn't translate (AP3).
 */
export function LanguageMenu({ language, disabled, onChange }: { language: string; disabled?: boolean; onChange: (language: string) => void }) {
  const shown = language.trim() || "English";
  // A language set some other way, e.g. by an imported file, stays on the list.
  const names = DOCUMENT_LANGUAGES.some((entry) => entry.name === shown) ? DOCUMENT_LANGUAGES.map((entry) => entry.name) : [shown, ...DOCUMENT_LANGUAGES.map((entry) => entry.name)];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="text" size="sm" aria-disabled={disabled || undefined} className="data-[state=open]:text-ink">
          {shown}
          {caret}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
        <DropdownMenuLabel>Rewrite the letter in a language</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={shown} onValueChange={(value) => !disabled && value !== shown && onChange(value)}>
          {names.map((name) => (
            <DropdownMenuRadioItem key={name} value={name}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
