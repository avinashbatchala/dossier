"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { ActionResult } from "@/lib/action";

/** How long a toast stays on screen. */
export const TOAST_DURATION_MS = 3200;
/** How long a toast with an action (e.g. Undo) stays, so there's time to use it. */
export const TOAST_WITH_ACTION_DURATION_MS = 6000;

export type ToastAction = { label: string; onClick: () => void };

type Toast = { id: number; message: string; action?: ToastAction };

// One toast at a time: a new one replaces the current one.
let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: Toast | null) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function dismiss(id: number) {
  if (current?.id === id) publish(null);
}

/**
 * Shows a short confirmation or friendly error at the bottom of the screen.
 * With an `action`, the toast gets a button (e.g. Undo) and stays longer.
 */
export function toast(message: string, options: { action?: ToastAction } = {}): void {
  publish({ id: nextId++, message, action: options.action });
}

/**
 * Shows a Server Action's outcome: its `toast` when it succeeded, its error
 * when it failed. Returns the result, so it can wrap the call:
 *
 *     const result = toastResult(await markSent({ id }));
 */
export function toastResult<T>(result: ActionResult<T>): ActionResult<T> {
  if (!result.ok) toast(result.error);
  else if (result.toast) toast(result.toast);
  return result;
}

/**
 * Renders the current toast. Mounted once in the root layout. The live
 * region is always present, so screen readers announce each new message.
 * The timer pauses while the pointer or keyboard focus is on the toast.
 */
export function Toaster() {
  const shown = useSyncExternalStore(subscribe, () => current, () => null);
  // The toast the pointer or keyboard focus is on. Tied to its id, so a new
  // toast is never paused by an old one.
  const [pausedId, setPausedId] = useState<number | null>(null);
  const paused = shown !== null && pausedId === shown.id;

  useEffect(() => {
    if (!shown || paused) return;
    const duration = shown.action ? TOAST_WITH_ACTION_DURATION_MS : TOAST_DURATION_MS;
    const timer = setTimeout(() => dismiss(shown.id), duration);
    return () => clearTimeout(timer);
  }, [shown, paused]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-7 z-40 flex justify-center px-4"
    >
      {shown && (
        <div
          key={shown.id}
          onMouseEnter={() => setPausedId(shown.id)}
          onMouseLeave={() => setPausedId(null)}
          onFocus={() => setPausedId(shown.id)}
          onBlur={() => setPausedId(null)}
          className="pointer-events-auto flex max-w-[520px] items-baseline gap-4 rounded-toast bg-inverse px-[18px] py-3 text-sm text-on-inverse shadow-toast motion-safe:animate-toast-in"
        >
          <span>{shown.message}</span>
          {shown.action && (
            <button
              type="button"
              onClick={() => {
                dismiss(shown.id);
                shown.action?.onClick();
              }}
              className="shrink-0 font-medium underline underline-offset-3 focus-visible:outline-on-inverse"
            >
              {shown.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
