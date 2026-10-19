"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { NATURAL_ORDER, type Sort, type SortKey } from "@/lib/applications-list";
import { cn } from "@/lib/cn";
import { STATUSES } from "@/lib/status";

import { RowMenu } from "./row-menu";

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "role", label: "Role", className: "w-[34%]" },
  { key: "status", label: "Status", className: "w-[168px]" },
  { key: "match", label: "Match", className: "w-[76px]" },
  { key: "location", label: "Location", className: "w-[18%]" },
  { key: "sent", label: "Sent", className: "w-[88px]" },
  { key: "updated", label: "Updated", className: "w-[118px]" },
];

/** A column's direction as `aria-sort` names it. */
function direction({ key, reversed }: Sort): "ascending" | "descending" {
  const natural = NATURAL_ORDER[key];
  return reversed ? (natural === "ascending" ? "descending" : "ascending") : natural;
}

/**
 * The table (LST-5, LST-6): sortable columns, a status select on each row,
 * and a click anywhere on a row to open it. The role is a link, so rows are
 * reachable by keyboard.
 */
export function Table({
  rows,
  sort,
  onSort,
  onMove,
}: {
  /** Already sorted by the server. */
  rows: ApplicationRow[];
  sort: Sort;
  onSort: (sort: Sort) => void;
  onMove: (row: ApplicationRow, to: ApplicationStatus) => void;
}) {
  const router = useRouter();
  return (
    // Relative, so screen-reader-only text is clipped with the table.
    <div className="relative mx-10 mb-16 overflow-x-auto rounded-panel border border-line-card bg-card">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? direction(sort) : undefined}
                  className={cn("py-3 pr-4 font-normal first:pl-5", column.className)}
                >
                  <button
                    type="button"
                    onClick={() => onSort({ key: column.key, reversed: active ? !sort.reversed : false })}
                    className={cn("text-label hover:text-ink", active ? "text-ink" : "text-muted")}
                  >
                    {column.label}
                    {active && <span aria-hidden="true">{direction(sort) === "descending" ? " ↓" : " ↑"}</span>}
                  </button>
                </th>
              );
            })}
            <th scope="col" className="w-12 pr-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={(event) => {
                // The select, the menu and the link handle their own clicks.
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
                  {row.company}
                  {row.archived && <span className="ml-2 rounded-[6px] bg-track px-1.5 text-xs">Archived</span>}
                </span>
              </td>
              <td className="py-3.5 pr-4">
                <span className="flex items-center gap-2">
                  <StatusDot status={row.status} />
                  <select
                    aria-label={`Status of ${[row.role, row.company].filter(Boolean).join(", ")}`}
                    value={row.status}
                    onChange={(event) => onMove(row, event.target.value as ApplicationStatus)}
                    className="-ml-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-[6px] border border-transparent bg-transparent py-1 pr-2 pl-1.5 text-sm text-ink hover:border-line-field focus-visible:border-primary"
                  >
                    {STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </span>
              </td>
              <td className="py-3.5 pr-4 text-sm tabular-nums">{row.match ? `${row.match.hit}/${row.match.total}` : "Not matched"}</td>
              <td className="truncate py-3.5 pr-4 text-sm text-muted">{row.location || "Not given"}</td>
              <td className="py-3.5 pr-4 text-sm text-muted">{row.sent ?? "Not sent"}</td>
              <td className="py-3.5 pr-4 text-sm text-muted">{row.updated}</td>
              <td className="py-3.5 pr-3 text-right">
                <RowMenu row={row} onMove={(to) => onMove(row, to)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
