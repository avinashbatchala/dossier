"use client";

import { useId, useState } from "react";

import { controlBaseClassName } from "@/components/ui/field";
import { SelectControl } from "@/components/ui/select";
import { cn } from "@/lib/cn";

const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(Date.UTC(2000, index, 1)),
);
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export type MonthYear = { month: number | null; year: number | null };

/** The year typed so far, if it's a whole plausible year. */
export function parseYear(text: string): number | null {
  if (!/^\d{4}$/.test(text.trim())) return null;
  const year = Number(text.trim());
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

/**
 * A date as month (optional) and year, as decided for experience and
 * education (#36). The year only counts once it's a four-digit year; a
 * half-typed one isn't saved as something wrong.
 */
export function MonthYearField({
  label,
  value,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  value: MonthYear;
  onChange: (value: MonthYear) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [yearText, setYearText] = useState(value.year === null ? "" : String(value.year));
  const [left, setLeft] = useState(false);
  const invalid = left && yearText.trim() !== "" && parseYear(yearText) === null;
  const errorId = `${id}-error`;

  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-[7px]", className)} disabled={disabled}>
      <legend className="mb-[7px] text-label text-muted">{label}</legend>
      <div className="flex gap-2">
        <SelectControl
          aria-label={`${label} month`}
          value={value.month ?? ""}
          onChange={(event) =>
            onChange({ ...value, month: event.target.value ? Number(event.target.value) : null })
          }
          wrapperClassName="flex-1"
          className={cn(controlBaseClassName, "w-full min-w-0 py-2.5")}
        >
          <option value="">Month</option>
          {MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </SelectControl>
        <input
          aria-label={`${label} year`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder="Year"
          value={yearText}
          onChange={(event) => {
            setYearText(event.target.value);
            onChange({ ...value, year: parseYear(event.target.value) });
          }}
          onBlur={() => setLeft(true)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className={cn(controlBaseClassName, "w-[5.5rem] flex-none px-3 py-[11px] tabular-nums")}
        />
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="text-label text-error">
          Enter a four-digit year, like 2021.
        </p>
      )}
    </fieldset>
  );
}
