"use client";

import { useTransition } from "react";

import { changeStatus } from "@/components/change-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { STATUSES, statusInfo } from "@/lib/status";

export type DemoApplication = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
};

/** Changes a real application's status through the shared action, with the Undo toast. */
export function StatusChangeDemo({ application }: { application: DemoApplication | null }) {
  const [pending, startTransition] = useTransition();

  if (!application) {
    return (
      <p className="text-sm text-muted">
        No applications yet. Load the demo data with <code className="font-mono">docker/bin/yarn prisma db seed -- --demo</code>.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span className="text-sm">
        {application.company || "Untitled"} · {application.role || "No role"}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className="flex items-center gap-[9px] rounded-full border border-line-control bg-card px-3.5 py-[9px] text-sm font-medium hover:border-line-strong"
        >
          <StatusDot status={application.status} />
          {statusInfo(application.status).label}
          <span aria-hidden="true" className="text-[10px] text-muted">
            ▼
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Move this application to</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={application.status}
            onValueChange={(value) =>
              startTransition(async () => {
                await changeStatus(application.id, value as ApplicationStatus);
              })
            }
          >
            {STATUSES.map(({ value, label }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <StatusDot status={value} />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
