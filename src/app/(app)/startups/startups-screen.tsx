"use client";

import { Rocket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { FilterChip, FilterChips, listingList, listingPreview, ListingRow, listingScreen, listingSplit, ListingTabs, PreviewBody, PreviewCard, PreviewFacts, PreviewHeader, PreviewReasons, RowTag, SourceBar } from "@/components/listing";
import { PageHeader } from "@/components/page-header";
import { ScoreMenu } from "@/components/score-menu";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useJob } from "@/hooks/use-job";
import { formatDateTime } from "@/lib/dates";
import { postedAgo } from "@/lib/job-search/search";
import {
  STARTUP_SOURCE_INFO,
  STARTUP_SOURCES,
  STARTUP_VIEW_LABELS,
  STARTUP_VIEWS,
  startupFilterHref,
  type StartupEmail,
  type StartupFilter,
  type StartupsRefresh,
  type StartupStatusName,
  type StartupView,
  type StartupViewName,
} from "@/lib/startups/types";

import { lookUpStartupAddresses, refreshStartupsNow, removeStartupForGood, saveStartupNotes, setStartupStatus, startScoringStartup } from "./actions";

export type StartupsScreenProps = {
  filter: StartupFilter;
  list: { startups: StartupView[]; total: number; counts: Record<StartupViewName, number> };
  lastRefresh: StartupsRefresh | null;
  refreshJobId: string | null;
  /** The profile's city and country, for the place filter; "" when not set. */
  city: string;
  country: string;
  /** The profile's headline, for the subject of an email from the user's own mail. */
  headline: string;
  /** Whether an AI provider is set up, so "Start application" can write one. */
  aiReady: boolean;
  today: string;
  /** Each profile's name by its id when there are several (E24-6), to say which one a startup fits best; empty with one. */
  profileNames?: Record<string, string>;
};

/**
 * The Startups screen (#222, E32-4): startups that are hiring, from YC
 * startups' job posts and Hacker News' "Who is hiring?", ranked against the
 * profile, on the list pattern: where they come from, tabs for where they
 * stand (PL1), filters as chips, the list and a preview. Rows have no ring:
 * the startup's own score only sorts them (U1). Dossier sends nothing: the
 * user writes to each one.
 */
export function StartupsScreen({ filter, list, lastRefresh, refreshJobId, city, country, headline, aiReady, today, profileNames = {} }: StartupsScreenProps) {
  const router = useRouter();
  const [jobId, setJobId] = useState(refreshJobId);
  const [starting, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState(list.startups[0]?.id ?? null);
  const selected = list.startups.find((startup) => startup.id === selectedId) ?? list.startups[0] ?? null;

  const job = useJob<StartupsRefresh>(jobId, 0, (update) => {
    if (update.status !== "DONE" && update.status !== "FAILED") return;
    setJobId(null);
    if (update.status === "FAILED") return toast(update.error ?? "The refresh didn't finish. Try again.");
    const added = update.result?.added ?? 0;
    toast(added > 0 ? `Found ${added} new ${added === 1 ? "startup" : "startups"}.` : "No new startups this time.");
    router.refresh();
  });
  const refreshing = Boolean(jobId) && (!job || job.status === "QUEUED" || job.status === "RUNNING");

  const refresh = () =>
    startTransition(async () => {
      const result = toastResult(await refreshStartupsNow({}));
      if (result.ok) setJobId(result.data.jobId);
    });

  const go = (change: Partial<StartupFilter>) => router.replace(startupFilterHref({ ...filter, ...change }), { scroll: false });
  const failed = lastRefresh?.sources.filter((source) => source.error) ?? [];

  return (
    <div className={listingScreen}>
      <PageHeader
        title="Startups"
        description={`Startups that are hiring ${country ? `in ${country}, or remotely from there` : "where you live, or remotely"}: from YC startups' job posts and Hacker News' “Who is hiring?”. You write to each one yourself.`}
      />
      <div className="flex flex-col gap-3 px-10 pb-4">
        <SourceBar
          label="Sources"
          icon={<Rocket size={16} />}
          chips={["YC job posts", "HN “Who is hiring?”", city || country ? `${city || country} or remote` : "Anywhere"]}
          note={
            refreshing ? (
              <span role="status">{job?.step ?? "Starting…"} This takes a minute or two.</span>
            ) : lastRefresh ? (
              `Refreshed ${formatDateTime(new Date(lastRefresh.at), undefined, new Date(today))} · reads their sites politely, following robots.txt`
            ) : (
              "Not refreshed yet"
            )
          }
          actions={
            <Button size="sm" aria-disabled={refreshing || starting || undefined} onClick={() => !refreshing && !starting && refresh()}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          }
        />
        {failed.length > 0 && !refreshing && (
          <p role="note" className="rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning">
            {failed.map((source) => source.error).join("; ")}. {failed.length < (lastRefresh?.sources.length ?? 0) ? "The other one worked. " : ""}The next refresh tries again.
          </p>
        )}
        {!lastRefresh && !refreshing && (
          <div role="note" className="flex max-w-[760px] flex-col gap-2 text-sm text-pretty text-muted">
            <p>
              Press <strong className="text-ink">Refresh</strong> to look for startups. Dossier reads YC startups&apos; job posts and this month&apos;s “Who is hiring?”
              thread on Hacker News, keeps the ones that hire where you live or remotely, and looks on the best matches&apos; own sites for the address they publish
              for applications, following their robots.txt.
            </p>
            <p>After that it refreshes once a day while you use this screen. Nothing is sent to anyone: you decide whom to write to.</p>
          </div>
        )}
      </div>

      {lastRefresh && (
        <>
          <div className="flex flex-col gap-2 border-b border-line px-10">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <ListingTabs
                label="Where they stand"
                current={filter.view}
                tabs={STARTUP_VIEWS.map((view) => ({ key: view, label: STARTUP_VIEW_LABELS[view], count: list.counts[view], href: startupFilterHref({ ...filter, view }) }))}
              />
              <div className="flex flex-wrap items-center gap-3 pb-2">
                <FilterChips>
                  <SearchChip value={filter.q} onChange={(q) => go({ q })} />
                  <FilterChip
                    label="Source"
                    value={filter.source}
                    options={[{ value: "" as const, label: "any" }, ...STARTUP_SOURCES.map((source) => ({ value: source, label: STARTUP_SOURCE_INFO[source].name }))]}
                    onChange={(source) => go({ source })}
                  />
                  <FilterChip
                    label="Where"
                    value={filter.place}
                    options={[
                      { value: "any" as const, label: "anywhere" },
                      ...(city ? [{ value: "city" as const, label: city }] : []),
                      ...(country ? [{ value: "country" as const, label: country }] : []),
                      { value: "remote" as const, label: country ? `remote, open to ${country}` : "remote" },
                    ]}
                    onChange={(place) => go({ place })}
                  />
                  <FilterChip
                    label="Address"
                    value={filter.withEmail ? "yes" : "any"}
                    options={[
                      { value: "any", label: "any" },
                      { value: "yes", label: "one to write to" },
                    ]}
                    onChange={(value) => go({ withEmail: value === "yes" })}
                  />
                </FilterChips>
                <FilterChip
                  label="Sort"
                  value={filter.sort}
                  options={[
                    { value: "match", label: "Best match" },
                    { value: "newest", label: "Newest" },
                  ]}
                  onChange={(sort) => go({ sort })}
                />
              </div>
            </div>
          </div>

          <div className={listingSplit}>
            <div className={listingList}>
              {list.startups.length === 0 ? (
                <Empty filter={filter} />
              ) : (
                <>
                  <p className="px-5 pt-3 pb-1 text-meta text-muted">
                    {list.total > list.startups.length ? `The best ${list.startups.length} of ${list.total}` : `${list.total} ${list.total === 1 ? "startup" : "startups"}`}
                    {filter.sort === "match" ? ", best match first" : ", newest first"}
                  </p>
                  <ul aria-label="Startups" className="flex flex-col border-t border-line">
                    {list.startups.map((startup) => (
                      <li key={startup.id}>
                        <ListingRow
                          selected={startup.id === selected?.id}
                          dimmed={startup.status === "DISMISSED"}
                          onClick={() => setSelectedId(startup.id)}
                          title={startup.roles[0] || startup.company}
                          tag={<StatusTag startup={startup} />}
                          sub={[startup.roles[0] ? startup.company : "", startup.stage, startup.location || (startup.remote ? "Remote" : "")].filter(Boolean).join(" · ")}
                          // Its match reasons as one short line, and where it hires from (E32-4).
                          meta={[...startup.reasons.filter((reason) => reason.good).slice(0, 2).map((reason) => reason.text), startup.hiresFrom ?? ""].filter(Boolean).join(" · ")}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            {selected && (
              <StartupPreview
                // Status, addresses and notes change it: start over when they do.
                key={`${selected.id}:${selected.status}:${selected.emails.length}:${selected.aiScored}:${selected.score}`}
                startup={selected}
                profiles={Object.entries(profileNames).map(([id, name]) => ({ id, name }))}
                headline={headline}
                aiReady={aiReady}
                today={today}
                profileName={selected.profileId ? profileNames[selected.profileId] : undefined}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The free-text search, as a chip that holds a field. */
function SearchChip({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [q, setQ] = useState(value);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange(q.trim());
  };
  return (
    <form role="search" aria-label="Filter startups" onSubmit={submit} className="inline-flex">
      <input
        aria-label="Search"
        value={q}
        placeholder="Search: android, fintech…"
        onChange={(event) => setQ(event.target.value)}
        onBlur={() => q.trim() !== value && onChange(q.trim())}
        className="w-[190px] rounded-full border border-line-control bg-transparent px-3 py-1 text-[13px] text-ink placeholder:text-muted"
      />
    </form>
  );
}

function StatusTag({ startup }: { startup: StartupView }) {
  const label = startup.status === "CONTACTED" || startup.applicationId ? "Applied" : startup.status === "SAVED" ? "Saved" : startup.status === "NEW" ? "New" : startup.status === "DISMISSED" ? "Dismissed" : "";
  return label ? <RowTag>{label}</RowTag> : null;
}

function Empty({ filter }: { filter: StartupFilter }) {
  const filtered = filter.q || filter.place !== "any" || filter.source || filter.withEmail;
  return (
    <p className="mx-5 my-4 rounded-panel border border-dashed border-line-strong px-7 py-10 text-center text-sm text-muted">
      {filtered ? "None match these filters. Try fewer." : filter.view === "NEW" ? "Nothing new to look at. The next refresh may bring more." : "None here yet."}
    </p>
  );
}

const mailto = (email: string, company: string, headline: string) =>
  `mailto:${email}?subject=${encodeURIComponent(headline ? `${headline}, interested in joining ${company}` : `Interested in joining ${company}`)}`;

/** The selected startup: what it does and why it fits, how to write to it, and the post. */
function StartupPreview({
  startup: initial,
  profiles,
  headline,
  aiReady,
  today,
  profileName,
}: {
  startup: StartupView;
  /** Every profile, when there are several, for Score's menu (#524). */
  profiles: readonly { id: string; name: string }[];
  headline: string;
  aiReady: boolean;
  today: string;
  /** The profile it fits best, when there are several. */
  profileName?: string;
}) {
  const router = useRouter();
  const headingId = useId();
  const [startup, setStartup] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // Score (#524): the job under way, "" while it's being started.
  const [scoreJob, setScoreJob] = useState<string | null>(null);
  const scoring = useJob<{ score: number }>(scoreJob || null, 0, (job) => {
    if (job.status !== "DONE" && job.status !== "FAILED") return;
    setScoreJob(null);
    if (job.status === "DONE") router.refresh();
    else toast(job.error ?? "The startup couldn't be scored. Try again.");
  });
  const info = STARTUP_SOURCE_INFO[startup.source];
  const posted = postedAgo(startup.postedAt, new Date(today));
  const blocked = Boolean(startup.noApplicationsFrom);
  const applied = startup.status === "CONTACTED" || startup.applicationId !== null;
  const page = startup.website || startup.links[0]?.url || "";

  const move = async (status: StartupStatusName, message: string) => {
    if (busy) return;
    setBusy(status);
    const before = startup.status;
    const result = toastResult(await setStartupStatus({ id: startup.id, status }));
    setBusy(null);
    if (!result.ok) return;
    toast(message, {
      action: {
        label: "Undo",
        onClick: () => void setStartupStatus({ id: startup.id, status: before }).then((undone) => toastResult(undone).ok && router.refresh()),
      },
    });
    router.refresh();
  };

  const lookUp = async (people: boolean) => {
    if (busy) return;
    setBusy(people ? "people" : "emails");
    const result = toastResult(await lookUpStartupAddresses({ id: startup.id, people }));
    setBusy(null);
    if (!result.ok) return;
    const added = result.data.emails.length - startup.emails.length;
    setStartup({ ...result.data, hiresFrom: startup.hiresFrom });
    if (result.data.noApplicationsFrom) toast("Their site says they don't take unsolicited applications.");
    else if (added > 0) toast(`Found ${added} ${added === 1 ? "address" : "addresses"} on their site.`);
    else toast(people ? "Their site doesn't publish anyone's own address." : "Their site doesn't publish an address for applications. Try their careers page.");
  };

  const score = async (profile?: string) => {
    if (scoreJob !== null) return;
    setScoreJob("");
    const result = toastResult(await startScoringStartup({ id: startup.id, profiles: profile }));
    if (result.ok && "setLevels" in result.data) {
      // The profile's levels aren't chosen yet (E24-3): where to choose them.
      const { message, href } = result.data.setLevels;
      setScoreJob(null);
      toast(message, { action: { label: "Choose levels", onClick: () => window.location.assign(href) } });
      return;
    }
    setScoreJob(result.ok && "jobId" in result.data ? result.data.jobId : null);
  };

  const remove = async () => {
    setRemoving(false);
    if (toastResult(await removeStartupForGood({ id: startup.id })).ok) router.refresh();
  };

  const kicker = [
    startup.status === "DISMISSED" ? "Dismissed" : applied ? "Applied for" : startup.status === "SAVED" ? "Saved" : "New",
    `${info.name} ${info.kind}${posted ? `, ${posted.toLowerCase() === "today" || posted.toLowerCase() === "yesterday" ? posted.toLowerCase() : posted}` : ""}`,
  ].join(" · ");

  return (
    <section
      aria-labelledby={headingId}
      className={listingPreview}
    >
      <PreviewHeader
        id={headingId}
        kicker={kicker}
        title={startup.roles[0] || startup.company}
        sub={[startup.roles[0] ? startup.company : "", startup.stage, startup.location, startup.remote && !/remote/i.test(startup.location) ? "Remote" : ""].filter(Boolean).join(" · ")}
        actions={
          <>
            {startup.applicationId ? (
              <Link href={`/applications/${startup.applicationId}`} className={buttonClassName("primary", "sm")}>
                Open the application
              </Link>
            ) : !blocked && aiReady ? (
              <Link href={`/new?startup=${encodeURIComponent(startup.id)}`} className={buttonClassName("primary", "sm")}>
                Start application <span aria-hidden="true">→</span>
              </Link>
            ) : null}
            {startup.status !== "DISMISSED" && !applied && (
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={startup.status === "SAVED"}
                aria-disabled={busy !== null || undefined}
                onClick={() => void (startup.status === "SAVED" ? move("NEW", `${startup.company} is back in New.`) : move("SAVED", `Saved ${startup.company}.`))}
              >
                {startup.status === "SAVED" ? (
                  <>
                    Saved <span aria-hidden="true">✓</span>
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            )}
            {page && (
              <a href={page} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
                Their page<span aria-hidden>↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {!applied && startup.status !== "DISMISSED" && (
              <Button size="sm" variant="text" aria-disabled={busy !== null || undefined} onClick={() => void move("CONTACTED", `Marked ${startup.company} as applied for.`)}>
                I wrote to them
              </Button>
            )}
          </>
        }
        quiet={
          startup.status === "DISMISSED" || startup.status === "CONTACTED" ? (
            <Button size="sm" variant="text" onClick={() => void move("NEW", `${startup.company} is back in New.`)}>
              Move back
            </Button>
          ) : (
            <Button size="sm" variant="text" onClick={() => void move("DISMISSED", `Dismissed ${startup.company}.`)}>
              Dismiss
            </Button>
          )
        }
      />

      {!aiReady && !blocked && !startup.applicationId && (
        <p className="text-meta text-muted">
          <Link href="/settings?section=ai" className="underline underline-offset-2 hover:text-ink">
            Choose an AI provider
          </Link>{" "}
          to write an application to them.
        </p>
      )}
      {blocked && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning">
          Their site says they don&apos;t take unsolicited applications: {startup.noApplicationsFrom}. Apply through a posted job instead.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PreviewCard label="Why it fits">
          {startup.reasons.length > 0 ? (
            <PreviewReasons reasons={startup.reasons} />
          ) : (
            <p className="text-sm text-muted">Nothing in particular stood out against your profile.</p>
          )}
          {profileName && <p className="text-meta text-muted">Best fit: your “{profileName}” profile</p>}
          <div className="flex flex-wrap items-center gap-3">
            <ScoreMenu profiles={profiles} disabled={scoreJob !== null} onScore={(profile) => void score(profile)}>
              <Button variant="secondary" size="sm" className="self-start" aria-disabled={scoreJob !== null || undefined} onClick={scoreJob !== null || profiles.length > 1 ? undefined : () => void score()}>
                {scoreJob !== null ? "Scoring…" : startup.aiScored ? "Score again" : "Score"}
              </Button>
            </ScoreMenu>
            {scoreJob !== null && (
              <span role="status" className="text-meta text-muted">
                {scoring?.step ?? "Starting…"}
              </span>
            )}
          </div>
        </PreviewCard>
        <PreviewCard label="Facts">
          <PreviewFacts
            facts={[
              { label: "What they do", value: startup.summary },
              { label: "Hiring", value: startup.roles.length > 1 ? startup.roles.join(", ") : "" },
              { label: "Where", value: [startup.location, startup.hiresFrom ?? ""].filter(Boolean).join(" · ") },
              { label: "Address", value: startup.emails.length > 0 ? <Emails emails={startup.emails} company={startup.company} headline={headline} /> : startup.emailsCheckedAt ? "None published" : "" },
            ].filter((fact) => fact.value)}
          />
          {startup.website && !blocked && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Button size="sm" variant="text" aria-disabled={busy !== null || undefined} onClick={() => void lookUp(false)}>
                {busy === "emails" ? "Looking…" : startup.emailsCheckedAt ? "Look on their site again" : "Find addresses on their site"}
              </Button>
              {startup.emailsCheckedAt && (
                <Button size="sm" variant="text" aria-disabled={busy !== null || undefined} onClick={() => void lookUp(true)}>
                  {busy === "people" ? "Looking…" : "Look for people's addresses"}
                </Button>
              )}
            </div>
          )}
          {startup.peopleCheckedAt && startup.emails.some((entry) => entry.onRequest) && (
            <p className="text-meta text-muted">People&apos;s own addresses are dropped after 14 days unless you write to this startup.</p>
          )}
        </PreviewCard>
      </div>

      {(startup.details || startup.summary) && (
        <div role="region" aria-label="Their post" className="border-t border-line pt-5">
          <PreviewBody>{startup.details || startup.summary}</PreviewBody>
        </div>
      )}
      {startup.links.length > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
          {startup.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-muted underline underline-offset-2 hover:text-ink">
              {link.label} ↗
            </a>
          ))}
        </p>
      )}
      <Notes id={startup.id} initial={startup.notes} />
      <Button size="sm" variant="danger-text" className="self-start" onClick={() => setRemoving(true)}>
        Remove for good
      </Button>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${startup.company} for good?`}
        description="Dossier deletes what it keeps about this startup, its addresses and your notes, and refreshes leave it out from now on. An application you started stays."
        confirmLabel="Remove for good"
        onConfirm={() => void remove()}
      />
    </section>
  );
}

function Notes({ id, initial }: { id: string; initial: string }) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const save = async () => {
    if (notes === saved) return;
    if (toastResult(await saveStartupNotes({ id, notes })).ok) setSaved(notes);
  };
  return <Textarea label="Notes" rows={3} value={notes} maxLength={5_000} onChange={(event) => setNotes(event.target.value)} onBlur={() => void save()} />;
}

function Emails({ emails, company, headline }: { emails: StartupEmail[]; company: string; headline: string }) {
  const copy = (email: string) =>
    void navigator.clipboard.writeText(email).then(
      () => toast(`Copied ${email}.`),
      () => toast("Couldn't copy it. Select the address instead."),
    );
  return (
    <ul aria-label="Addresses they publish" className="flex flex-col gap-1.5">
      {emails.map((entry) => (
        <li key={entry.email} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <a href={mailto(entry.email, company, headline)} className="font-medium text-link underline-offset-2 hover:underline">
            {entry.email}
          </a>
          <span className="text-meta text-muted">{entry.label}</span>
          <button type="button" onClick={() => copy(entry.email)} className="text-meta text-muted underline underline-offset-2 hover:text-ink">
            Copy
          </button>
          {/^https?:\/\//.test(entry.from) && (
            <a href={entry.from} target="_blank" rel="noopener noreferrer" className="text-meta text-muted hover:text-ink">
              where it&apos;s published ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
