import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

import { controlClassName, FieldShell, useField, type FieldProps } from "./field";

export type SelectControlProps = ComponentProps<"select"> & {
  /** The tighter padding of small selects (30px tall or less). */
  compact?: boolean;
  /** Classes for the wrapper that holds the select and its arrow, e.g. its flex sizing. */
  wrapperClassName?: string;
};

/**
 * A native select with Dossier's own arrow (#46). The browser's arrow sits
 * against the right edge whatever the padding, and differs between browsers;
 * this one is inset as far as the text is. Owns the horizontal padding, so
 * pass sizes, borders and colors but no `px-*`. The wrapper never gets
 * narrower than that padding and the border, so the arrow stays inside the
 * select however tight its row: don't give it `min-w-0`.
 */
export function SelectControl({ compact = false, className, wrapperClassName, ...props }: SelectControlProps) {
  return (
    <span className={cn("relative flex", compact ? "min-w-[2.375rem]" : "min-w-11", wrapperClassName)}>
      <select className={cn("cursor-pointer appearance-none", compact ? "pr-7 pl-2" : "pr-8 pl-2.5", className)} {...props} />
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted",
          compact ? "right-2 size-3.5" : "right-2.5 size-4",
        )}
      />
    </span>
  );
}

export type SelectProps = ComponentProps<"select"> &
  FieldProps & {
    /** Classes for the wrapper around label, select and messages. */
    className?: string;
    selectClassName?: string;
  };

/**
 * A native select (as in the prototype) with an optional label, hint and
 * error. Pass `<option>` elements as children.
 */
export function Select({
  label,
  hint,
  error,
  id,
  className,
  selectClassName,
  ...props
}: SelectProps) {
  const field = useField({ id, hint, error });
  return (
    <FieldShell {...field} label={label} hint={hint} error={error} className={className}>
      <SelectControl {...field.controlProps} className={cn(controlClassName, "py-2.5", selectClassName)} {...props} />
    </FieldShell>
  );
}
