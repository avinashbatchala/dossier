import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type ToggleChipProps = Omit<ComponentProps<"button">, "type"> & {
  selected: boolean;
  /** Prefix "✓ " while selected, as skill chips do. */
  check?: boolean;
};

/** A pill that is switched on or off (`aria-pressed`), e.g. a skill attached to a role. */
export function ToggleChip({
  selected,
  check = false,
  className,
  children,
  ...props
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-3 py-1.5 text-meta disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-primary bg-selected font-medium text-primary-text"
          : "border-line-field bg-input text-ink hover:border-line-strong hover:bg-hover",
        className,
      )}
      {...props}
    >
      {check && selected && <span aria-hidden="true">✓ </span>}
      {children}
    </button>
  );
}

export type RemovableChipProps = {
  children: ReactNode;
  /** Extra detail after the label, e.g. "2 roles". */
  meta?: ReactNode;
  onRemove: () => void;
  /** Accessible name of the remove button, e.g. "Remove Figma". */
  removeLabel: string;
  className?: string;
};

/** A pill with a × button that removes it, e.g. a skill in the profile. */
export function RemovableChip({
  children,
  meta,
  onRemove,
  removeLabel,
  className,
}: RemovableChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line-field bg-input py-[7px] pr-2 pl-[13px] text-control",
        className,
      )}
    >
      {children}
      {meta && <span className="text-xs text-muted">{meta}</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="rounded-full px-1 text-sm leading-none text-muted hover:text-ink"
      >
        <span aria-hidden="true">×</span>
      </button>
    </span>
  );
}
