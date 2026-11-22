"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";

import { changeStatus } from "@/components/change-status";

import { PageHeader } from "@/components/page-header";
import { buttonClassName } from "@/components/ui/button";
import { toastResult } from "@/components/toast";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { listHref, statusesIn, statusParamLabel, type ListParams, type StatusParam, type View } from "@/lib/applications-list";
import { cn } from "@/lib/cn";

import { rememberListView, reorderBoard } from "./actions";
import { Board } from "./board";
import { hasOwnColumns, StatusTable } from "./status-table";
import { Table } from "./table";

export type ApplicationsScreenProps = {
  params: ListParams;
  /** The applications in view: searched and sorted, and for a list, of the status on show. */
  rows: ApplicationRow[];
  /** The status tabs (E29-1): every application that isn't archived, then each status's. */
  tabs: { all: number; statuses: { status: StatusParam; label: string; color: string; count: number; href: string }[] };
  summary: string;
  /** No applications at all yet. */
  empty: boolean;
  /** Archived applications, hidden unless shown (E9-5). */
  archivedCount: number;
  /** Each open lane's sub-line (E29-3). */
  laneNotes?: Partial<Record<ApplicationStatus, string>>;
  /** Google's calendar is in use, for the interview popover (E29-5). */
  calendar?: boolean;
};

const HINTS: Record<View, string> = {
  board: "Drag a card to change its status",
  list: "Click a row to open it",
};

/** How long typing pauses before the search runs. */
const SEARCH_DELAY_MS = 250;

/**
 * The Applications screen (LST-1, LST-2, E29-1): the title (a status's, with
 * its dot, when one is on show), a line on what stands out, Board / List,
 * the search and the status tabs. Every change goes into the URL and the
 * server answers with the matching applications.
 */
export function ApplicationsScreen({ params, rows, tabs, summary, empty, archivedCount, laneNotes, calendar = false }: ApplicationsScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.q);
  // Back and forward change the URL's search; the box follows.
  const [urlQuery, setUrlQuery] = useState(params.q);
  if (params.q !== urlQuery) {
    setUrlQuery(params.q);
    if (params.q !== query.trim()) setQuery(params.q);
  }
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A moved or reordered card shows in its new place at once; if the
  // change fails, it goes back (LST-4).
  const [shown, showMove] = useOptimistic(
    rows,
    (
      current,
      change: { kind: "status"; id: string; to: ApplicationStatus } | { kind: "reorder"; ordered: ApplicationRow[] },
    ) =>
      change.kind === "status"
        ? current.map((row) => (row.id === change.id ? { ...row, status: change.to, boardSort: null, updated: "Today", updatedAt: Date.now() } : row))
        : current.map((row) => {
            const index = change.ordered.findIndex((entry) => entry.id === row.id);
            return index < 0 ? row : { ...row, boardSort: index };
          }),
  );
  const [, startMove] = useTransition();
  const move = (row: ApplicationRow, to: ApplicationStatus) =>
    startMove(async () => {
      showMove({ kind: "status", id: row.id, to });
      await changeStatus(row.id, to);
    });
  // A reordered column shows in its new order at once, then writes it (public issue 60).
  const reorder = (ordered: ApplicationRow[]) =>
    startMove(async () => {
      showMove({ kind: "reorder", ordered });
      toastResult(await reorderBoard({ status: ordered[0].status, ids: ordered.map((row) => row.id) }));
    });

  // Each view or sort gets its own history entry, so Back returns to it, and
  // is remembered for the next visit (LST-7), per status for the view (LB1),
  // before the page asks for it. Typing a search only updates the current entry.
  const go = (next: Partial<ListParams>, { replace = false } = {}) => {
    clearTimeout(typing.current);
    const state = { ...params, q: query.trim(), ...next };
    const href = listHref(state);
    const remember = "view" in next || "sort" in next;
    startTransition(async () => {
      if (remember) await rememberListView({ view: state.view, status: state.status, sort: state.sort });
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  };

  const search = (value: string) => {
    setQuery(value);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => go({ q: value.trim() }, { replace: true }), SEARCH_DELAY_MS);
  };

  // On the board the screen keeps to the window and each column scrolls on
  // its own; the list scrolls with the page.
  const board = !empty && rows.length > 0 && params.view === "board";
  const status = params.status;
  // A tab keeps the view, the search and "Show archived".
  const tabHref = (to: StatusParam | null) => listHref({ ...params, q: query.trim(), status: to, view: to ? "list" : params.view });

  return (
    <div className={cn("flex flex-col", board ? "h-panel min-h-[520px]" : "flex-1")}>
      <PageHeader
        title={
          status ? (
            <span className="flex items-center gap-3">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: tabs.statuses.find((tab) => tab.status === status)?.color }} />
              {statusParamLabel(status)}
            </span>
          ) : (
            "Applications"
          )
        }
        description={summary}
        // New application is the sidebar's (E27-7).
        actions={
          <SegmentedControl<View>
            aria-label="View"
            size="sm"
            options={[
              { value: "board", label: "Board" },
              { value: "list", label: "List" },
            ]}
            value={params.view}
            onValueChange={(view) => go({ view })}
          />
        }
      />

      {empty ? (
        <FirstApplication />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-10 pb-[18px]">
            <input
              type="search"
              aria-label="Search applications"
              placeholder="Search company or role"
              value={query}
              onChange={(event) => search(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && go({ q: query.trim() }, { replace: true })}
              className="min-w-[180px] flex-[0_1_260px] rounded-control border border-line-input bg-input px-3 py-2.5 text-sm placeholder:text-muted focus-visible:border-primary focus-visible:outline-offset-0"
            />
            {/* The sidebar's statuses, as tabs (E29-1). */}
            <nav aria-label="Statuses" className="flex flex-wrap gap-1.5">
              <StatusTab href={tabHref(null)} current={!status} label="All" count={tabs.all} />
              {tabs.statuses.map((tab) => (
                <StatusTab key={tab.status} href={tabHref(tab.status)} current={status === tab.status} label={tab.label} count={tab.count} color={tab.color} />
              ))}
            </nav>
            {archivedCount > 0 && (
              <button
                type="button"
                aria-pressed={params.archived}
                onClick={() => go({ archived: !params.archived })}
                className="rounded-control px-1 py-2 text-control text-muted underline-offset-3 hover:text-ink aria-pressed:text-ink aria-pressed:underline"
              >
                Show archived{" "}
                <span className="text-xs opacity-65">{archivedCount}</span>
              </button>
            )}
            <span className="ml-auto text-meta text-muted">{HINTS[params.view]}</span>
          </div>

          <div className={cn("flex min-h-0 flex-1 flex-col motion-safe:transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
            {rows.length === 0 ? (
              <Nothing>{params.q ? `No applications match “${params.q}”.` : "Nothing in this view yet."}</Nothing>
            ) : board ? (
              <Board rows={shown} statuses={statusesIn("all")} onMove={move} onReorder={reorder} notes={laneNotes} openClosed={status === "closed"} calendar={calendar} highlight={status} />
            ) : (
              // A status's own columns (E29-2); All and Closed keep the general list.
              hasOwnColumns(status) ? (
                <StatusTable status={status} rows={shown} onMove={move} />
              ) : (
                <Table rows={shown} sort={params.sort} onSort={(sort) => go({ sort })} onMove={move} />
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One status tab: its dot, name and count; the one on show is marked. */
function StatusTab({ href, current, label, count, color }: { href: string; current: boolean; label: string; count: number; color?: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-control border px-3 py-2 text-control text-ink no-underline",
        current ? "border-primary bg-selected font-medium" : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
      )}
    >
      {color && <span aria-hidden="true" className="size-[7px] rounded-full" style={{ background: color }} />}
      {label}
      <span className="text-xs opacity-65">{count}</span>
    </Link>
  );
}

/** When the search or filter leaves nothing to show. */
function Nothing({ children }: { children: ReactNode }) {
  return (
    <div className="mx-10 mb-16 rounded-panel border border-line-card bg-card px-5 py-9 text-center text-sm text-muted">{children}</div>
  );
}

/** Before the first application: where to start. */
function FirstApplication() {
  return (
    <div className="mx-10 mb-16 flex max-w-[640px] flex-col items-start gap-3 rounded-panel border border-line-card bg-card px-7 py-7">
      <h2 className="font-serif text-section">Your first application</h2>
      <p className="text-sm text-muted">
        Paste a job posting and I&apos;ll read it, check it against your profile and draft a tailored resume and cover letter. Your
        profile is what everything is built from, so it&apos;s worth filling in first.
      </p>
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Link href="/new?fresh=1" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
          + New application
        </Link>
        <Link href="/profile" className="text-sm text-muted underline underline-offset-2 hover:text-ink">
          Fill in your profile
        </Link>
      </div>
    </div>
  );
}
