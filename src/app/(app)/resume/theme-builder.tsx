"use client";

import { RadioGroup } from "radix-ui";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeFont } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import {
  ACCENTS,
  ALIGNMENTS,
  DATE_STYLES,
  DENSITIES,
  HEADER_STYLES,
  HEADING_STYLES,
  LAYOUTS,
  SIDEBAR_STYLES,
  THEME_FONTS,
  accentName,
  hasSidebar,
  readableOnWhite,
  type ThemeData,
} from "@/lib/themes";

/** A theme being customised: a custom theme's id, or null for a new one. */
export type ThemeDraft = Omit<ThemeData, "id" | "builtIn"> & { id: string | null };

/** Where the builder starts: a copy named "My theme" of a built-in, or the custom theme itself. */
export function draftFrom({ builtIn, id, ...theme }: ThemeData): ThemeDraft {
  return builtIn ? { ...theme, id: null, name: "My theme" } : { ...theme, id };
}

const options = <T extends string>(labels: Record<T, { label: string }>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value].label }));

const FONT_OPTIONS = Object.values(ThemeFont).map((font) => ({
  value: font,
  label: THEME_FONTS[font].label,
  font: THEME_FONTS[font].family,
}));

type ThemeBuilderProps = {
  draft: ThemeDraft;
  onChange: (draft: ThemeDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
};

/** The Customize tab (RES-3): every change shows in the preview as you make it. */
export function ThemeBuilder({ draft, onChange, onSave, onCancel, saving }: ThemeBuilderProps) {
  const set = <K extends keyof ThemeDraft>(key: K) => (value: ThemeDraft[K]) => onChange({ ...draft, [key]: value });
  // Minimal's grey and custom colours aren't swatches; keep them on offer while they're the draft's colour.
  const accents = ACCENTS.some((accent) => accent.value === draft.accent)
    ? ACCENTS
    : [{ value: draft.accent, name: accentName(draft.accent) }, ...ACCENTS];
  const split = hasSidebar(draft.layout);

  return (
    <form
      className="flex flex-col gap-[22px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <Input
        label="Theme name"
        value={draft.name}
        maxLength={60}
        placeholder="My theme"
        onChange={(event) => set("name")(event.target.value)}
      />
      <Choices label="Heading font" value={draft.headFont} options={FONT_OPTIONS} onChange={set("headFont")} />
      <Choices label="Body font" value={draft.bodyFont} options={FONT_OPTIONS} onChange={set("bodyFont")} />
      <Group
        label="Accent"
        hint={readableOnWhite(draft.accent) ? undefined : "This color is light, so text in it is hard to read. A darker one works better."}
      >
        {(labelId) => (
          <>
            <RadioGroup.Root
              aria-labelledby={labelId}
              orientation="horizontal"
              value={draft.accent}
              onValueChange={set("accent")}
              className="flex flex-wrap gap-1.5"
            >
              {accents.map((accent) => (
                <RadioGroup.Item
                  key={accent.value}
                  value={accent.value}
                  aria-label={accent.name}
                  title={accent.name}
                  className="size-7 rounded-full data-[state=checked]:shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]"
                  style={{ background: accent.value }}
                />
              ))}
            </RadioGroup.Root>
            <CustomColor value={draft.accent} onChange={set("accent")} />
          </>
        )}
      </Group>
      <Choices label="Layout" value={draft.layout} options={options(LAYOUTS)} onChange={set("layout")} />
      {split && <Choices label="Sidebar" value={draft.sidebarStyle} options={options(SIDEBAR_STYLES)} onChange={set("sidebarStyle")} />}
      <Choices
        label="Header"
        value={split ? "LEFT" : draft.align}
        options={options(ALIGNMENTS)}
        onChange={set("align")}
        disabled={split}
        hint={split ? "Sidebar layouts always align the header left." : undefined}
      />
      <Choices label="Header style" value={draft.headerStyle} options={options(HEADER_STYLES)} onChange={set("headerStyle")} />
      <Choices label="Section titles" value={draft.headingStyle} options={options(HEADING_STYLES)} onChange={set("headingStyle")} />
      <Choices label="Dates" value={draft.dateStyle} options={options(DATE_STYLES)} onChange={set("dateStyle")} />
      <Choices label="Spacing" value={draft.density} options={options(DENSITIES)} onChange={set("density")} />
      <div className="flex gap-2 pt-1.5">
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? "Saving…" : "Save theme"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Any accent: the system colour picker, and the colour as hex to type or
 * paste ("1f6f5c" works too). Typing takes effect once it's a whole colour;
 * the rest of the time the field shows the draft's.
 */
function CustomColor({ value, onChange }: { value: string; onChange: (accent: string) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Custom color"
        title="Custom color"
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        className="size-[34px] flex-none cursor-pointer rounded-control border border-line-field bg-card p-[3px] hover:border-line-strong"
      />
      <Input
        aria-label="Hex color"
        value={typing ?? value}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setTyping(value)}
        onBlur={() => setTyping(null)}
        onChange={(event) => {
          const text = event.target.value.trim();
          setTyping(text);
          const hex = text.startsWith("#") ? text : `#${text}`;
          if (HEX.test(hex)) onChange(hex.toLowerCase());
        }}
        className="w-[112px]"
        inputClassName="py-[7px] font-mono text-control"
      />
    </div>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: (labelId: string) => ReactNode }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-[9px]">
      <span id={labelId} className="text-label text-muted">
        {label}
      </span>
      {children(labelId)}
      {hint && <p className="text-label text-muted">{hint}</p>}
    </div>
  );
}

/** One choice out of a few, shown as chips; a radio group underneath. */
function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; font?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Group label={label} hint={hint}>
      {(labelId) => (
        <RadioGroup.Root
          aria-labelledby={labelId}
          orientation="horizontal"
          value={value}
          onValueChange={(next) => onChange(next as T)}
          disabled={disabled}
          className="flex flex-wrap gap-1.5"
        >
          {options.map((option) => (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              className={cn(
                "rounded-control border border-line-field bg-card px-3 py-[7px] text-control text-ink hover:border-line-strong",
                "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-on-primary",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-field",
              )}
              style={option.font ? { fontFamily: option.font } : undefined}
            >
              {option.label}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      )}
    </Group>
  );
}
