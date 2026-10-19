import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

import { controlClassName, FieldShell, useField, type FieldProps } from "./field";

export type InputProps = ComponentProps<"input"> &
  FieldProps & {
    /** Classes for the wrapper around label, input and messages. */
    className?: string;
    inputClassName?: string;
  };

/** A text input with an optional label, hint and error. */
export function Input({
  label,
  hint,
  error,
  id,
  className,
  inputClassName,
  ...props
}: InputProps) {
  const field = useField({ id, hint, error });
  return (
    <FieldShell {...field} label={label} hint={hint} error={error} className={className}>
      <input
        {...field.controlProps}
        className={cn(controlClassName, "h-10 px-3", inputClassName)}
        {...props}
      />
    </FieldShell>
  );
}
