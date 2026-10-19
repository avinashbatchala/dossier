"use client";

import { Popover } from "radix-ui";
import { useOptimistic, useState, useSyncExternalStore, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/dates";

import { setInterviewDate } from "./actions";

const never = () => () => {};

/** "2026-10-01T14:00" in the browser's time zone, as a datetime-local input takes it. */
function localInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * The next interview's date and time (E9-9), beside the status while the
 * application is in Interview. Moving it to Interview opens this by itself
 * (`asking`), where skipping is fine. Times are the browser's; the server
 * renders them in the zone the browser told it last.
 */
export function InterviewDate({
  id,
  at,
  timeZone,
  open,
  asking,
  onOpenChange,
}: {
  id: string;
  at: Date | null;
  /** The time zone the page was rendered for; the browser's own takes over once it runs. */
  timeZone?: string;
  open: boolean;
  /** Opened because the application just moved to Interview. */
  asking: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zone = useSyncExternalStore(never, () => undefined, () => timeZone);
  const [shown, show] = useOptimistic(at);
  const [, startTransition] = useTransition();

  const save = (next: Date | null) => {
    onOpenChange(false);
    startTransition(async () => {
      show(next);
      toastResult(await setInterviewDate({ id, at: next ? next.toISOString() : null }));
    });
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={shown ? `Next interview: ${formatDateTime(shown, zone)}. Change` : "Add the interview date"}
        className="flex items-center gap-2 rounded-full border border-line-control bg-card px-3.5 py-[9px] text-sm hover:border-line-strong data-[state=open]:border-primary"
      >
        {shown ? (
          <>
            <span className="text-muted">Interview</span>
            <span className="font-medium">{formatDateTime(shown, zone)}</span>
          </>
        ) : (
          <span className="font-medium">+ Interview date</span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={asking ? "When's the interview?" : "Next interview"}
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-30 w-[min(320px,calc(100vw-32px))] rounded-card border border-line-popover bg-card p-5 shadow-menu"
        >
          <InterviewForm initial={shown} asking={asking} onSave={save} onCancel={() => onOpenChange(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The popover's form; mounted on every open, so it starts from what's saved. */
function InterviewForm({
  initial,
  asking,
  onSave,
  onCancel,
}: {
  initial: Date | null;
  asking: boolean;
  onSave: (at: Date | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() => (initial ? localInputValue(initial) : ""));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) onSave(new Date(value));
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-medium">{asking ? "When's the interview?" : "Next interview"}</h2>
        <p className="text-meta text-muted">{asking ? "Optional. " : ""}It shows on your dashboard, flagged the day before.</p>
      </div>
      <Input type="datetime-local" label="Date and time" value={value} onChange={(event) => setValue(event.target.value)} required />
      <div className="flex items-center gap-2">
        {initial && (
          <Button variant="danger-text" size="sm" onClick={() => onSave(null)}>
            Remove
          </Button>
        )}
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onCancel}>
          {asking ? "Skip" : "Cancel"}
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}
