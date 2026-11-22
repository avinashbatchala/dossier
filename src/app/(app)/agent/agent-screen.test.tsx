import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { AgentCandidateView, AgentView } from "@/lib/agent/view";

import { approveAgentDraft, dismissAgentCandidate, prepareAgentDraft, runAgentNow } from "./actions";
import { AgentScreen } from "./agent-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/agent" }));
vi.mock("@/hooks/use-job", () => ({ useJob: () => null }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean }) => result }));
vi.mock("./actions", () => ({
  runAgentNow: vi.fn(async () => ({ ok: true, data: { jobId: "run-1", reused: false } })),
  prepareAgentDraft: vi.fn(async () => ({ ok: true, data: { jobId: "draft-1", applicationId: null } })),
  approveAgentDraft: vi.fn(async () => ({ ok: true, data: { applicationId: "app-1" } })),
  dismissAgentCandidate: vi.fn(async () => ({ ok: true, data: { undo: null } })),
  restoreAgentCandidate: vi.fn(async () => ({ ok: true, data: null })),
}));

const card = (id: string, score: number, extra: Partial<AgentCandidateView> = {}): AgentCandidateView => ({
  searches: [],
  id,
  title: `Posting ${id}`,
  company: `Company ${id}`,
  facts: "Rotterdam · €70k",
  origin: "Posted 2 days ago · via LinkedIn on JSearch",
  source: "JSEARCH",
  url: `https://jobs.example/${id}`,
  coverage: { hit: Math.round(score / 20), total: 5, mustMissing: 0 },
  description: `The whole posting ${id}.`,
  reasons: [`Reason for ${id}`],
  redFlags: [],
  error: null,
  applicationId: null,
  draftJobId: null,
  ...extra,
});
const view: AgentView = {
  searches: [],
  budget: [{ portal: "JSEARCH", name: "JSearch", used: 0 }],
  nextEligibility: "Wed 21 Oct, 07:00",
  timeZone: "Europe/Berlin",
  searchHistory: [],
  searchResults: [],
  enabled: true,
  autoDraft: false,
  covers: "two-thirds",
  maxScores: 15,
  maxDrafts: 3,
  setupProblem: null,
  setupSection: null,
  limitReached: false,
  lastRun: { at: "Tue 20 Oct, 07:00", message: "2 new postings are waiting for a look." },
  nextRun: "Wed 21 Oct, 07:00",
  runJobId: null,
  drafts: [card("d1", 91, { applicationId: "app-1", redFlags: ["German required"] })],
  finds: [card("f1", 80, { searches: [{ searchId: "one", searchName: "Design" }] }), card("f2", 60)],
  skipped: [card("s1", 0, { coverage: { hit: 0, total: 0, mustMissing: 0 }, why: "Past the run's scoring limit: it stays in Positions unscored" })],
  waiting: 2,
};
const open = (changes: Partial<AgentView> = {}, tab?: "drafts" | "finds" | "skipped") => render(<AgentScreen view={{ ...view, ...changes }} tab={tab} />);

beforeEach(() => vi.clearAllMocks());

describe("AgentScreen (E16-6)", () => {
  it.each([null, "The agent scan was interrupted. Try again."])("does not present a collected source page as overall success for batch outcome %s", (batchMessage) => {
    const search = { id: "one", name: "Incomplete", query: { keywords: "Designer", place: "", country: "", radiusKm: 25 as const, remoteOnly: false, postedWithin: "any" as const }, enabled: false, sort: 0, profileId: null, allProfiles: false, createdAt: new Date(), updatedAt: new Date() };
    open({ searches: [search], searchHistory: [{ searchId: "one", searchName: search.name, found: 3, fresh: 0, error: null, at: "Tue 20 Oct, 07:00", batchMessage }] });
    expect(screen.getByText("Designer · No country selected")).toBeInTheDocument();
    expect(screen.getByText(/Last source request completed:/)).toBeInTheDocument();
    expect(screen.queryByText(/Last success/)).not.toBeInTheDocument();
    expect(screen.getByText(batchMessage ? `Batch outcome: ${batchMessage}` : "Batch pending or still processing; discovery counts may be incomplete.")).toBeInTheDocument();
  });

  it("shows quota, per-search results and historical attribution without changing review actions", () => {
    const search = { id: "one", name: "Renamed", query: { keywords: "Designer", place: "Berlin", country: "de", radiusKm: 25 as const, remoteOnly: false, postedWithin: "any" as const }, enabled: true, sort: 0, profileId: null, allProfiles: false, createdAt: new Date(), updatedAt: new Date() };
    const result = { searchId: "one", searchName: "Original", found: 10, fresh: 4, error: "Source failed" };
    open({
      searches: [search],
      budget: [{ portal: "JSEARCH", name: "JSearch", used: 2 }, { portal: "FREEHIRE", name: "FreeHire", used: 0 }],
      limitReached: true,
      searchHistory: [{ ...result, at: "Tue 20 Oct, 07:00", batchMessage: "Interrupted" }],
      searchResults: [result, { ...result, searchId: "gone", searchName: "Removed", error: null }],
      drafts: [card("d1", 84, { applicationId: "app-1", searches: [{ searchId: "one", searchName: "Original" }, { searchId: null, searchName: "Removed" }] })],
    });
    expect(screen.getByText("Requests left in 24 hours").nextElementSibling).toHaveTextContent("JSearch: 1 of 3 · FreeHire: 3 of 3");
    expect(screen.getByText("Whole-batch quota eligibility").nextElementSibling).toHaveTextContent("Wed 21 Oct, 07:00 (Europe/Berlin)");
    expect(screen.getByText("Renamed · Enabled")).toBeInTheDocument();
    expect(screen.getByText(/Last source request failed:/)).toHaveTextContent("10 found · 4 new to agent");
    expect(screen.getByText("Run as “Original”")).toBeInTheDocument();
    expect(screen.getByText(/Removed \(deleted search\):/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Facts" })).toHaveTextContent("Found byOriginal, Removed (deleted search)");
    expect(screen.getByText(/Found counts may overlap/)).toBeInTheDocument();
  });

  it("says what it searches, when it ran and when it runs next (E32-5)", () => {
    open();
    expect(screen.getByRole("heading", { level: 1, name: "Job agent" })).toBeInTheDocument();
    const bar = within(screen.getByRole("region", { name: "Agent" }));
    expect(bar.getByText("Next run Wed 21 Oct, 07:00")).toBeInTheDocument();
    expect(bar.getByText("Ran Tue 20 Oct, 07:00 · 3 of 3 requests left today")).toBeInTheDocument();
    expect(screen.getByText("Last run: 2 new postings are waiting for a look.")).toBeInTheDocument();
    expect(screen.getByText("Enabled searches").nextElementSibling).toHaveTextContent("0 of 0");
    expect(screen.getByText("Next run").nextElementSibling).toHaveTextContent("Wed 21 Oct, 07:00");
  });

  it("has tabs for its drafts, its best finds and what it skipped, with counts (PL3)", () => {
    open();
    const tabs = within(screen.getByRole("navigation", { name: "What it found" })).getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Drafts to review 1", "Best finds 2", "Skipped 1"]);
    expect(tabs[1]).toHaveAttribute("href", "/agent?tab=finds");
  });

  it("offers Prepare draft on a best find, and says why one was skipped", async () => {
    const user = userEvent.setup();
    const { unmount } = open({}, "finds");
    const finds = within(screen.getByRole("list", { name: "Best finds" }));
    expect(finds.getAllByRole("button").map((row) => row.textContent)).toEqual([expect.stringContaining("Found by Design"), expect.stringContaining("Posting f2")]);
    await user.click(screen.getByRole("button", { name: "Prepare draft" }));
    expect(prepareAgentDraft).toHaveBeenCalledWith({ candidateId: "f1" });
    unmount();
    open({}, "skipped");
    expect(within(screen.getByRole("list", { name: "Skipped" })).getByRole("button")).toHaveTextContent("Past the run's scoring limit: it stays in Positions unscored");
    expect(screen.getByRole("region", { name: "How it fits" })).toHaveTextContent("Not scored");
  });

  it("lists drafts to review, resume and letter ready, with Review draft, Approve and Dismiss", async () => {
    const user = userEvent.setup();
    open();
    const drafts = within(screen.getByRole("list", { name: "Drafts to review" }));
    expect(drafts.getByRole("button", { name: /^Posting d1/ })).toHaveTextContent("resume and letter ready");
    expect(drafts.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Posting d1" })).toBeInTheDocument();
    expect(drafts.getByRole("img", { name: "5 of 5 requirements covered" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review draft" })).toHaveAttribute("href", "/applications/app-1");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(approveAgentDraft).toHaveBeenCalledWith({ candidateId: "d1" });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("asks before dismissing a draft, since it deletes it", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Dismiss with its draft" }));
    const dialog = screen.getByRole("alertdialog", { name: "Dismiss this draft?" });
    expect(dismissAgentCandidate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Dismiss draft" }));
    expect(dismissAgentCandidate).toHaveBeenCalledWith({ candidateId: "d1" });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Dismissed, with its draft. It won't come back."));
  });

  it("labels an Adzuna posting's draft with a link to Adzuna, as its terms ask", () => {
    open({ drafts: [card("d1", 84, { applicationId: "app-1", source: "ADZUNA", url: "https://www.adzuna.nl/land/ad/1" })] });
    expect(screen.getByRole("link", { name: "Jobs by Adzuna (opens in a new tab)" })).toHaveAttribute("href", "https://www.adzuna.nl");
  });

  it("runs now on request", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Run all now" }));
    expect(runAgentNow).toHaveBeenCalledWith({});
    expect(screen.getByRole("button", { name: "Running…" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Starting the run…");
  });

  it("points to Settings while it's off, not set up, or out of runs for the day", () => {
    const { unmount } = open({ enabled: false, nextRun: null });
    expect(screen.getByRole("note")).toHaveTextContent("The job agent is off. Turn it on in Settings → Job agent. What it found before is still here, and in Positions.");
    expect(screen.getByRole("link", { name: "Turn it on in Settings → Job agent" })).toHaveAttribute("href", "/settings?section=agent");
    expect(screen.getByText("Next run").nextElementSibling).toHaveTextContent("Off");
    unmount();

    const second = open({ setupProblem: "Switch on a portal in Settings → Job search first.", setupSection: "jobs" });
    expect(screen.getByRole("note")).toHaveTextContent("Switch on a portal. Go to Settings → Job search");
    expect(screen.getByRole("link", { name: "Go to Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
    second.unmount();

    open({ limitReached: true });
    expect(screen.getByRole("note")).toHaveTextContent("The whole batch needs more source requests than are available.");
  });

  it("links missing Jev credentials to the scoring settings", () => {
    open({ setupProblem: "Enter your TypeSafe key in Settings → Scoring first.", setupSection: "scoring" });
    expect(screen.getByRole("link", { name: "Go to Settings → Scoring" })).toHaveAttribute("href", "/settings?section=scoring");
  });

  it("says when there's nothing yet", () => {
    open({ drafts: [], finds: [], skipped: [], waiting: 0, lastRun: null, autoDraft: true });
    expect(screen.getByText("No drafts yet. After a run, the best new postings get a draft here.")).toBeInTheDocument();
    expect(screen.getByText("Last run").nextElementSibling).toHaveTextContent("Not yet");
  });
});
