import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type FieldProps = {
  /** Visible label. Without one, give the control an `aria-label`. */
  label?: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Error text under the control; also marks it `aria-invalid`. */
  error?: ReactNode;
};

/** The ids and ARIA attributes that tie a control to its label, hint and error. */
export function useField({ id, hint, error }: { id?: string } & FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = cn(hintId, errorId) || undefined;
  return {
    controlId,
    hintId,
    errorId,
    controlProps: {
      id: controlId,
      "aria-describedby": describedBy,
      "aria-invalid": error ? true : undefined,
    },
  };
}

/** Stacks a label, a control, a hint and an error, as in the prototype's forms. */
export function FieldShell({
  label,
  hint,
  error,
  controlId,
  hintId,
  errorId,
  className,
  children,
}: FieldProps & {
  controlId: string;
  hintId?: string;
  errorId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-[7px]", className)}>
      {label && (
        <label htmlFor={controlId} className="text-label font-medium text-ink">
          {label}
        </label>
      )}
      {children}
      {hint && (
        <p id={hintId} className="text-label text-muted">
          {hint}
        </p>
      )}
      {/* An alert, so screen readers say it when it appears (E11-3). */}
      {error && (
        <p id={errorId} role="alert" className="text-label text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** The look of text inputs, textareas and selects, without a width. */
export const controlBaseClassName =
  "rounded-control border border-line-input bg-input text-field text-ink shadow-control focus:border-primary aria-invalid:border-error disabled:cursor-not-allowed disabled:bg-paper disabled:text-muted";

/** Shared look of text inputs, textareas and selects, filling their container. */
export const controlClassName = `w-full ${controlBaseClassName}`;
