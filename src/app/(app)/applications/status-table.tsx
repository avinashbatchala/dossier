"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { ScoreRing } from "@/components/score-ring";
import { buttonClassName } from "@/components/ui/button";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { actionHref, rowAction } from "@/lib/applications-list";
import { cn } from "@/lib/cn";

import { RowMenu } from "./row-menu";

/** The statuses that have their own columns (E29-2); All and Closed keep the general list. */
export type ColumnStatus = "DRAFT" | "SENT" | "SCREENING" | "INTERVIEW" | "OFFER";
export const hasOwnColumns = (status: string | null): status is ColumnStatus =>
  status === "DRAFT" || status === "SENT" || status === "SCREENING" || status === "INTERVIEW" || status === "OFFER";

const dash = <span className="text-muted">–</span>;
const ring = (row: ApplicationRow) => (row.match ? <ScoreRing hit={row.match.hit} total={row.match.total} size="sm" /> : <span className="text-muted">Not matched</span>);
/** The flag's text in the warning colour when it's due this week. */
const flagged = (row: ApplicationRow, text: ReactNode) => <span className={cn(row.flag?.soon && "text-warning")}>{text}</span>;
const docs = (row: ApplicationRow) => (row.docs.resume && row.docs.letter ? "Resume and letter" : row.docs.resume ? "Resume" : row.docs.letter ? "Letter" : "Not yet");

/** Each status's columns after the application (E29-2): what matters at that stage. */
const COLUMNS: Record<ColumnStatus, { label: string; className: string; cell: (row: ApplicationRow) => ReactNode }[]> = {
  DRAFT: [
    { label: "Apply by", className: "w-[200px]", cell: (row) => (row.deadline && row.flag?.kind === "apply-by" ? flagged(row, row.flag.text.replace(/^Apply by /, "")) : (row.deadline ?? dash)) },
    { label: "Match", className: "w-[92px]", cell: ring },
    { label: "Docs ready", className: "w-[150px]", cell: docs },
  ],
  SENT: [
    {
      label: "Sent",
      className: "w-[150px]",
      cell: (row) => (
        <>
          <span className="block">{row.sent ?? dash}</span>
          {row.sentWay && <span className="block text-meta text-muted">{row.sentWay}</span>}
        </>
      ),
    },
    { label: "Quiet for", className: "w-[110px]", cell: (row) => (row.quietDays === null ? dash : flagged(row, `${row.quietDays} ${row.quietDays === 1 ? "day" : "days"}`)) },
    { label: "Match", className: "w-[92px]", cell: ring },
  ],
  SCREENING: [
    { label: "Last reply", className: "w-[130px]", cell: (row) => row.lastReply?.on ?? dash },
    { label: "From", className: "w-[200px]", cell: (row) => (row.lastReply ? <span className="block truncate">{row.lastReply.from}</span> : dash) },
  ],
  INTERVIEW: [
    { label: "Next interview", className: "w-[190px]", cell: (row) => (row.nextInterview ? flagged(row, row.nextInterview) : <span className="text-muted">No date yet</span>) },
    { label: "Round", className: "w-[80px]", cell: (row) => row.round ?? dash },
  ],
  OFFER: [
    { label: "Salary", className: "w-[180px]", cell: (row) => (row.salary ? <span className="block truncate">{row.salary}</span> : dash) },
    { label: "Decide by", className: "w-[130px]", cell: (row) => (row.flag?.kind === "decide-by" ? flagged(row, row.flag.text.replace(/^Decide by /, "")) : dash) },
  ],
};

/**
 * The rows in the order that status wants: what's due soonest first (Apply
 * by, the next interview, Decide by), the longest quiet first while Sent,
 * and the latest update first otherwise.
 */
function dueFirst(status: ColumnStatus, rows: ApplicationRow[]): ApplicationRow[] {
  if (status === "SENT") return rows.toSorted((a, b) => (b.quietDays ?? -1) - (a.quietDays ?? -1));
  if (status === "SCREENING") return rows;
  const due = (row: ApplicationRow) => row.flag?.due?.getTime() ?? Infinity;
  return rows.toSorted((a, b) => due(a) - due(b));
}

/**
 * One status's list (E29-2, design 2b): the application, the columns that
 * matter at that stage, and the next thing to do as a button that opens it
 * on the right tab. A click anywhere else on a row opens the application.
 */
export function StatusTable({ status, rows, onMove }: { status: ColumnStatus; rows: ApplicationRow[]; onMove: (row: ApplicationRow, to: ApplicationStatus) => void }) {
  const router = useRouter();
  const columns = COLUMNS[status];
  const ordered = dueFirst(status, rows);
  return (
    // Relative, so screen-reader-only text is clipped with the table.
    <div className="relative mx-10 mb-16 overflow-x-auto rounded-panel border border-line-card bg-card">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-label text-muted">
            <th scope="col" className="py-3 pr-4 pl-5 font-normal">
              Application
            </th>
            {columns.map((column) => (
              <th key={column.label} scope="col" className={cn("py-3 pr-4 font-normal", column.className)}>
                {column.label}
              </th>
            ))}
            <th scope="col" className="w-[200px] py-3 pr-4 font-normal">
              Next step
            </th>
            <th scope="col" className="w-12 pr-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => {
            const action = rowAction(row, "list");
            return (
              <tr
                key={row.id}
                onClick={(event) => {
                  // The links and the menu handle their own clicks.
                  if (!(event.target instanceof Element) || event.target.closest("a, button, select, [role=menu]")) return;
                  router.push(`/applications/${row.id}`);
                }}
                className="cursor-pointer border-b border-line last:border-b-0 hover:bg-hover"
              >
                <td className="py-3.5 pr-4 pl-5">
                  <Link href={`/applications/${row.id}`} className="block truncate text-field font-medium text-ink">
                    {row.role}
                  </Link>
                  <span className="block truncate text-meta text-muted">
                    {[row.company, row.location, row.mode].filter(Boolean).join(" · ")}
                    {row.archived && <span className="ml-2 rounded-[6px] bg-track px-1.5 text-xs">Archived</span>}
                  </span>
                </td>
                {columns.map((column) => (
                  <td key={column.label} className="py-3.5 pr-4 text-sm">
                    {column.cell(row)}
                  </td>
                ))}
                <td className="py-3.5 pr-4">
                  {action && (
                    <Link href={actionHref(row.id, action)} className={buttonClassName("secondary", "sm")}>
                      {action.label} <span className="sr-only">for {[row.role, row.company].filter(Boolean).join(", ")}</span>
                    </Link>
                  )}
                </td>
                <td className="py-3.5 pr-3 text-right">
                  <RowMenu row={row} onMove={(to) => onMove(row, to)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
