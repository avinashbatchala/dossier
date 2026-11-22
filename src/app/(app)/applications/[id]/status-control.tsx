"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";

import { changeStatus } from "@/components/change-status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/ui/status-dot";
import { ApplicationStatus, SentVia } from "@/generated/prisma/enums";
import { STATUSES, statusInfo } from "@/lib/status";

import { InterviewDate } from "./interview-date";

/** Mark as sent's choices (E29-7). Gmail sets its own when it sends. */
const SENT_WAYS: { value?: SentVia; label: string }[] = [
  { value: SentVia.EMAIL, label: "By email" },
  { value: SentVia.PORTAL, label: "On their site or a job portal" },
  { value: SentVia.OTHER, label: "Another way" },
  { label: "Just mark it as sent" },
];

/**
 * The status pill and its menu (APP-2), and the next interview's date while
 * it's in Interview (E9-9). The new status shows at once; the server's
 * answer (and its toast with Undo) follows. Moving to Interview asks for the
 * date once the menu has closed.
 */
export function StatusControl({
  id,
  status,
  interviewAt = null,
  timeZone,
}: {
  id: string;
  status: ApplicationStatus;
  interviewAt?: Date | null;
  timeZone?: string;
}) {
  const [shown, show] = useOptimistic(status);
  const [, startTransition] = useTransition();
  const [interview, setInterview] = useState<"edit" | "ask" | null>(null);
  const askForDate = useRef(false);
  const { label } = statusInfo(shown);

  const move = (to: ApplicationStatus, sentVia?: SentVia) => {
    if (to === shown) return;
    askForDate.current = to === ApplicationStatus.INTERVIEW;
    startTransition(async () => {
      show(to);
      await (sentVia ? changeStatus(id, to, sentVia) : changeStatus(id, to));
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Status: ${label}`}
            className="flex items-center gap-[9px] rounded-full border border-line-control bg-card px-3.5 py-[9px] text-sm font-medium hover:border-line-strong data-[state=open]:border-primary"
          >
            <StatusDot status={shown} />
            {label}
            <span aria-hidden="true" className="text-[10px] text-muted">
              ▼
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={(event) => {
            if (!askForDate.current) return;
            askForDate.current = false;
            event.preventDefault();
            setInterview("ask");
          }}
        >
          <DropdownMenuLabel>Move this application to</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={shown} onValueChange={(value) => move(value as ApplicationStatus)}>
            {STATUSES.map((entry) => (
              <DropdownMenuRadioItem key={entry.value} value={entry.value}>
                <StatusDot status={entry.value} />
                {entry.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {shown === ApplicationStatus.INTERVIEW && (
        <InterviewDate
          id={id}
          at={interviewAt}
          timeZone={timeZone}
          open={interview !== null}
          asking={interview === "ask"}
          onOpenChange={(open) => setInterview(open ? "edit" : null)}
        />
      )}
    </>
  );
}

/**
 * "Mark as sent" while the application is a draft (E29-7), asking how it
 * went out, which is optional: the last item just marks it. With the email
 * since E30-2, where sending finishes.
 */
export function MarkAsSent({ id, variant = "secondary" }: { id: string; variant?: "primary" | "secondary" }) {
  const [, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant}>Mark as sent</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>How did you send it?</DropdownMenuLabel>
        {SENT_WAYS.map(({ value, label }) => (
          <DropdownMenuItem
            key={label}
            onSelect={() =>
              startTransition(async () => {
                await (value ? changeStatus(id, ApplicationStatus.SENT, value) : changeStatus(id, ApplicationStatus.SENT));
              })
            }
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
