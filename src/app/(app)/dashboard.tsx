import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { statusHref } from "@/lib/applications-list";
import { DEFAULT_QUIET_DAYS, type DashboardFigures, type DashboardPeriod } from "@/lib/dashboard";
import type { DayPeriod } from "@/lib/greeting";
import { STATUSES } from "@/lib/status";

import { ActivityChart } from "./activity-chart";
import { DailyNote, type DailyNoteValue } from "./daily-note";
import { FunnelChart } from "./funnel-chart";
import { Greeting } from "./greeting";
import { NeedsYou } from "./needs-you";
import { PeriodControl, PeriodProvider, PeriodScoped } from "./period-filter";

const card = "flex flex-col rounded-panel border border-line-card bg-card";
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The dashboard (DSH-1 to DSH-6, laid out as the UI refresh's 2a, E28-1): a
 * header with today's date, the greeting and what needs the user this week;
 * then two zones. On the left, "Your search so far", which the period
 * scopes: the funnel, week by week, and where things stand. On the right,
 * this week, which it doesn't: Needs you and the calendar. Below about
 * 1500px they stack, the left zone first.
 */
export function Dashboard({
  figures,
  firstName,
  period,
  today,
  range = "all",
  quietDays = DEFAULT_QUIET_DAYS,
  empty,
  calendar,
  note,
}: {
  figures: DashboardFigures;
  firstName: string;
  period: DayPeriod;
  /** "Monday, 16 November", in the user's time zone. */
  today?: string;
  /** The time filter (E9-8). */
  range?: DashboardPeriod;
  /** Days without news before a follow-up is suggested (E9-9). */
  quietDays?: number;
  /** No applications at all yet. */
  empty: boolean;
  /** The calendar (E15-6), which the time filter doesn't scope. */
  calendar?: ReactNode;
  /** Today's note (E28-6): its text, null until it's written, "hidden" for today, or undefined for none. */
  note?: DailyNoteValue | "hidden";
}) {
  const { sent, heardBack } = figures.overall;
  const thisWeek = figures.needsYou.filter((item) => item.soon).length;
  return (
    <>
      <header className="-mx-px bg-paper pt-2">
        <div className="flex flex-col gap-1 rounded-t-panel border border-b-0 border-line-card bg-surface px-12 pt-7">
          {note !== undefined && note !== "hidden" && (
            <div className="pb-6">
              <DailyNote initial={note} />
            </div>
          )}
          {today && <p className="text-meta text-muted">{today}</p>}
          <h1 className="font-serif text-title text-pretty">
            <Greeting name={firstName} serverPeriod={period} />
          </h1>
          <p className="pt-1 text-lead text-pretty text-muted">
            {sent > 0 ? `${sent} sent, ${heardBack} heard back. ` : "Nothing sent yet. "}
            <strong className="font-medium text-ink">
              {thisWeek > 0 ? `${plural(thisWeek, "thing needs", "things need")} you this week.` : empty ? "Your first application is only a paste away." : "Nothing needs you this week."}
            </strong>
          </p>
        </div>
      </header>

      <div className="@container px-12 pt-7 pb-[72px]">
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 @min-[1500px]:grid-cols-[minmax(0,1fr)_580px]">
          {empty ? (
            <Welcome />
          ) : (
            <PeriodProvider period={range}>
              <section aria-labelledby="search-heading" className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="search-heading" className="text-meta text-muted">
                    Your search so far
                  </h2>
                  <PeriodControl aria-label="Period" />
                </div>
                <PeriodScoped className="flex flex-col gap-5">
                  <Funnel figures={figures} />
                  <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @min-[900px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                    <ActivityChart weeks={figures.weeks} />
                    <WhereThingsStand byStatus={figures.byStatus} />
                  </div>
                </PeriodScoped>
              </section>
            </PeriodProvider>
          )}
          <section aria-labelledby="week-heading" className="@container/week flex min-w-0 flex-col gap-3">
            <h2 id="week-heading" className="flex min-h-[30px] items-center text-meta text-muted">
              This week · not affected by the period
            </h2>
            {/* One above the other in the 580px column; side by side when the zones stack and there's room. */}
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @min-[900px]/week:grid-cols-2">
              {!empty && <NeedsYou items={figures.needsYou} quietDays={quietDays} />}
              {calendar}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/** "Your funnel" (DSH-2): how far every sent application got, closed ones included, as a Sankey diagram. */
function Funnel({ figures }: { figures: DashboardFigures }) {
  const { funnel, sent, heardBackPercent, reachedInterview } = figures;
  const offers = funnel.find((step) => step.stage === "OFFER")?.count ?? 0;
  return (
    <section aria-labelledby="funnel-heading" className={`${card} gap-6 p-7`}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="funnel-heading" className="font-serif text-section">
            Your funnel
          </h2>
          <p className="text-control text-muted">How far each application you&apos;ve sent has made it, and where the ones that stopped are now.</p>
        </div>
        <dl className="flex gap-7">
          <Figure value={String(sent)} label="sent" />
          <Figure value={heardBackPercent === null ? "None yet" : `${heardBackPercent}%`} label="heard back" />
          <Figure value={String(reachedInterview)} label="reached interview" />
          <Figure value={String(offers)} label="offers" />
        </dl>
      </div>
      <FunnelChart funnel={funnel} />
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="font-serif text-[32px] leading-none tabular-nums">{value}</dd>
    </div>
  );
}

/** "Where things stand" (DSH-4): every application by its status now, each row opening that status's list (E28-3). */
function WhereThingsStand({ byStatus }: { byStatus: Record<ApplicationStatus, number> }) {
  const present = STATUSES.filter(({ value }) => byStatus[value] > 0);
  return (
    <section aria-labelledby="standing-heading" className={`${card} gap-[18px] px-7 py-[26px]`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="standing-heading" className="text-[15px] font-medium">
          Where things stand
        </h2>
        <Link href="/applications?view=board" className="text-meta text-muted underline underline-offset-3 hover:text-ink">
          Open board
        </Link>
      </div>
      {/* The legend below says the same in words. */}
      <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-[6px] bg-hover">
        {present.map(({ value, color }) => (
          <span key={value} style={{ flex: byStatus[value], backgroundColor: color }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-1">
        {STATUSES.map(({ value, label }) => (
          <li key={value}>
            <Link
              href={statusHref(value)}
              className={`-mx-2 flex items-center gap-[9px] rounded-control px-2 py-1.5 text-sm no-underline hover:bg-hover hover:text-ink ${byStatus[value] > 0 ? "text-ink" : "text-muted"}`}
            >
              <StatusDot status={value} />
              <span className="flex-1">{label}</span>
              <span className="tabular-nums">{byStatus[value]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Before the first application: where to begin. */
function Welcome() {
  return (
    <Panel>
      <h2 className="font-serif text-section">Welcome to Dossier</h2>
      <p className="text-sm text-muted">
        Start with your profile: your roles, skills and education are what every tailored resume and cover letter is built from.
        Then paste a job posting, and your funnel and next steps will show up here.
      </p>
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Link href="/profile" className={buttonClassName("secondary")}>
          Fill in your profile
        </Link>
        <Link href="/new?fresh=1" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
          + New application
        </Link>
        <Link href="/welcome" className="text-sm text-muted underline underline-offset-2 hover:text-ink">
          Open the setup guide
        </Link>
      </div>
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className={`${card} items-start gap-3 p-7`}>{children}</div>;
}
