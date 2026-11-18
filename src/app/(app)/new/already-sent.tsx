"use client";

import { useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApplicationStatus } from "@/generated/prisma/enums";
import { statusInfo } from "@/lib/status";

import { addSentApplication } from "./actions";

// "Already sent it?" (public #129): an application sent before Dossier, added
// to keep track of it. Its details are typed in, so it needs no AI provider,
// and no resume or cover letter is written. The posting and link from the
// paste step go with it when they're there.

const STANDS = [
  ApplicationStatus.SENT,
  ApplicationStatus.SCREENING,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.DECLINED,
] as const;

/** Today in the browser's time zone, "2026-11-16". */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function AlreadySent({
  from,
  initial,
  onAdded,
  onCancel,
}: {
  /** What the paste step has: the posting, its link, the profile, and where it was started from. */
  from: { posting: string; postingUrl: string; profileId?: string; postingId: string | null; startupId: string | null };
  initial: { company: string; role: string };
  onAdded: (applicationId: string) => void;
  onCancel: () => void;
}) {
  const [company, setCompany] = useState(initial.company);
  const [role, setRole] = useState(initial.role);
  const [sentOn, setSentOn] = useState(today);
  const [status, setStatus] = useState<(typeof STANDS)[number]>(ApplicationStatus.SENT);
  const [adding, setAdding] = useState(false);

  const add = async () => {
    if (adding || (!company.trim() && !role.trim())) return;
    setAdding(true);
    const result = toastResult(await addSentApplication({ ...from, company, role, sentOn, status }));
    setAdding(false);
    if (result.ok) onAdded(result.data);
  };

  return (
    <Card className="flex flex-col gap-5" role="form" aria-label="Already sent">
      <div className="flex flex-col gap-1">
        <h2 className="text-field font-medium">Add one you&apos;ve already sent</h2>
        <p className="text-meta text-muted">
          To keep track of an application you sent before Dossier. No resume or cover letter is written, and nothing goes to the AI. The posting and link
          above are kept with it when you&apos;ve given them.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Company" value={company} onChange={(event) => setCompany(event.target.value)} />
        <Input label="Role" value={role} onChange={(event) => setRole(event.target.value)} />
        <Input label="Sent on" type="date" max={today()} value={sentOn} onChange={(event) => setSentOn(event.target.value)} />
        <Select label="Where it stands" value={status} onChange={(event) => setStatus(event.target.value as (typeof STANDS)[number])}>
          {STANDS.map((value) => (
            <option key={value} value={value}>
              {statusInfo(value).label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="text" onClick={onCancel}>
          Cancel
        </Button>
        <Button aria-disabled={adding || (!company.trim() && !role.trim()) || undefined} onClick={() => void add()}>
          {adding ? "Adding…" : "Add application"}
        </Button>
      </div>
    </Card>
  );
}
