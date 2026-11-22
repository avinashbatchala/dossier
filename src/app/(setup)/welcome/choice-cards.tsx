"use client";

import { RadioGroup } from "radix-ui";

/** One choice among cards, as in Settings: a name, a line about it and an optional tag. */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; name: string; description: string; tag?: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value ?? ""}
      onValueChange={(next) => onChange(next as T)}
      // Two by two when they pair up, so none is left alone on a row.
      className={options.length % 2 === 0 ? "grid gap-3 sm:grid-cols-2" : "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          aria-label={option.name}
          aria-describedby={`choice-${option.value}`}
          className="group flex flex-col gap-1.5 rounded-card border border-line-card bg-card p-[18px] text-left hover:border-line-strong data-[state=checked]:border-primary data-[state=checked]:shadow-[0_0_0_1px_var(--color-primary)]"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[15px] font-medium">{option.name}</span>
            <span aria-hidden className="grid size-4 place-items-center rounded-full border-[1.5px] border-line-strong group-data-[state=checked]:border-primary">
              <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
            </span>
          </span>
          <span id={`choice-${option.value}`} className="flex flex-col gap-1.5">
            <span className="text-meta text-pretty text-muted">{option.description}</span>
            {option.tag && <span className="text-xs text-muted">{option.tag}</span>}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
