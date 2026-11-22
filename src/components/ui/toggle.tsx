"use client";

import { Switch } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type ToggleProps = Omit<Switch.SwitchProps, "children"> & {
  label: ReactNode;
  description?: ReactNode;
};

/**
 * An on/off switch (`role="switch"` with `aria-checked`) in a settings row:
 * label and description on the left, switch on the right. Space toggles it,
 * and so does clicking the label.
 */
export function Toggle({ label, description, id, className, ...props }: ToggleProps) {
  const generated = useId();
  const switchId = id ?? generated;
  const descriptionId = description ? `${switchId}-description` : undefined;
  return (
    <div className={cn("flex items-center gap-5", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <label htmlFor={switchId} className="w-fit cursor-pointer text-field">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-meta text-muted">
            {description}
          </p>
        )}
      </div>
      <Switch.Root
        id={switchId}
        aria-describedby={descriptionId}
        className="flex h-6 w-10 shrink-0 items-center rounded-full bg-toggle-off p-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary motion-safe:transition-colors"
        {...props}
      >
        <Switch.Thumb className="block size-[18px] rounded-full bg-white shadow-knob data-[state=checked]:translate-x-4 data-[state=checked]:bg-on-primary motion-safe:transition-[transform,background-color]" />
      </Switch.Root>
    </div>
  );
}
