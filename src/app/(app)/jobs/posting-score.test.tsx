import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { ProfileFit } from "@/lib/job-search/search";
import type { JobView } from "@/lib/jobs/runner";
import { DEFAULT_FILTERS, type ShownPosting } from "@/lib/job-search/search";

import { startScoringPosting } from "./actions";
import { PostingResults } from "./posting-results";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => null, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));
vi.mock("../agent/actions", () => ({ prepareAgentDraft: vi.fn() }));
vi.mock("./actions", () => ({
  startApplicationFrom: vi.fn(),
  loadLibraryPage: vi.fn(),
  markPostingsSeen: vi.fn(),
  loadFullText: vi.fn(),
  savePostingForLater: vi.fn(),
  unsavePosting: vi.fn(),
  dismissFoundPosting: vi.fn(),
  restorePosting: vi.fn(),
  splitSameJob: vi.fn(),
  startScoringPosting: vi.fn(async () => ({ ok: true, data: { jobId: "score-job" } })),
}));
// The scoring job, as a test moves it along.
type Scored = { score: ProfileFit | null; scores: ProfileFit[] };
const jobs = vi.hoisted(() => ({ listeners: new Map<string, (job: JobView<Scored>) => void>() }));
vi.mock("@/hooks/use-job", () => ({
  useJob: (id: string | null, _revision: number, onChange: (job: JobView<Scored>) => void) => {
    if (id) jobs.listeners.set(id, onChange);
    return null;
  },
}));
const finish = (job: Partial<JobView<Scored>>) =>
  jobs.listeners.get("score-job")!({ id: "score-job", type: "posting-score", status: "DONE", step: null, error: null, result: null, ...job });

/** A breakdown covering `hit` of four requirements (E32-2). */
const covering = (hit: number) => ({ factors: [], cap: null, requirements: [0, 1, 2, 3].map((index) => ({ text: `R${index}`, mustHave: false, covered: index < hit, evidence: null })) });
const fit: ProfileFit = { profileId: "first", profileName: "", score: 78, reasons: ["Built a design system at Northwind."], redFlags: ["Dutch is required."], breakdown: null };
const scored = (best: ProfileFit) => ({ score: best, scores: [best] });
const posting = (id: string, score: ProfileFit | null = null): ShownPosting => ({
  source: "JSEARCH",
  externalId: id,
  title: `Designer ${id}`,
  company: "Ledgerly",
  place: "Amsterdam",
  remote: false,
  salary: "",
  postedAt: null,
  url: `https://jobs.example/${id}`,
  via: "",
  description: "The whole posting.",
  complete: true,
  state: { postingId: "row", new: false, saved: true, dismissed: false, applicationId: null, score, scores: score ? [score] : [], foundOn: [{ portal: "JSEARCH", url: "" }], archived: false, stillListedAt: null, agentSearches: [], agent: null },
});
const filters = { ...DEFAULT_FILTERS, show: "saved" as const };
const open = (postings: ShownPosting[]) =>
  render(<PostingResults postings={postings} filters={filters} total={postings.length} more={false} empty="Nothing saved yet." today="2026-10-20T10:00:00.000Z" />);

beforeEach(() => {
  vi.clearAllMocks();
  jobs.listeners.clear();
});

describe("Score in Find jobs (#208)", () => {
  it("scores the open posting in the background and shows how it fits", async () => {
    const user = userEvent.setup();
    open([posting("a")]);
    await user.click(screen.getByRole("button", { name: "Score" }));
    expect(startScoringPosting).toHaveBeenCalledWith({ posting: expect.not.objectContaining({ state: expect.anything() }), profiles: undefined });
    expect(screen.getByRole("button", { name: "Scoring…" })).toHaveAttribute("aria-disabled", "true");

    await waitFor(() => expect(jobs.listeners.has("score-job")).toBe(true));
    finish({ status: "RUNNING", step: "Scoring it against your profile" });
    expect(await screen.findByText("Scoring it against your profile")).toHaveAttribute("role", "status");
    finish({ status: "DONE", result: scored(fit) });

    // No breakdown: no requirements to count, and its reasons as they came (E32-2).
    expect(await screen.findByText("No requirements to check")).toBeInTheDocument();
    expect(screen.getByText("Built a design system at Northwind.")).toBeInTheDocument();
    expect(screen.getByText("Dutch is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Score again" })).toBeInTheDocument();
    // The list shows it too.
    expect(within(screen.getByRole("list", { name: "Postings" })).getByRole("img", { name: "No requirements to cover yet" })).toBeInTheDocument();
  });

  it("asks which profile to score against when there are several, and shows each one's score (E25-5)", async () => {
    const user = userEvent.setup();
    const profiles = [
      { id: "first", name: "Design" },
      { id: "backend", name: "Backend" },
    ];
    render(<PostingResults postings={[posting("a"), posting("b")]} filters={filters} total={2} more={false} empty="" today="2026-10-20T10:00:00.000Z" profiles={profiles} />);
    await user.click(screen.getByRole("button", { name: "Score" }));
    await user.click(await screen.findByRole("menuitem", { name: "All profiles" }));
    expect(startScoringPosting).toHaveBeenCalledWith({ posting: expect.objectContaining({ externalId: "a" }), profiles: "all" });

    await waitFor(() => expect(jobs.listeners.has("score-job")).toBe(true));
    const design = { ...fit, profileName: "Design", score: 64, breakdown: covering(1) };
    const backend = { ...fit, profileId: "backend", profileName: "Backend", score: 82, breakdown: covering(3) };
    finish({ status: "DONE", result: { score: backend, scores: [design, backend] } });

    // The card shows the best with its profile; the posting shows every profile's.
    const card = within(screen.getByRole("list", { name: "Postings" })).getAllByRole("listitem")[0];
    expect(await within(card).findByRole("img", { name: "3 of 4 requirements covered" })).toBeInTheDocument();
    expect(card).toHaveTextContent("fits Backend best");
    expect(within(screen.getByRole("region", { name: "Score for “Design”" })).getByText("Long shot")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Score for “Backend”" })).getByText("Strong fit")).toBeInTheDocument();

  });

  it("shows a score it already has, in the list and the posting", () => {
    open([posting("a", { ...fit, score: 91, breakdown: covering(4) }), posting("b")]);
    const list = screen.getByRole("list", { name: "Postings" });
    expect(within(list).getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("4 of 4 requirements covered")).toBeInTheDocument();
    // The unscored one says so.
    expect(within(list).getByRole("button", { name: /^Designer b/ })).toHaveTextContent("not scored yet");
  });

  it("says why when it can't score", async () => {
    const user = userEvent.setup();
    vi.mocked(startScoringPosting).mockResolvedValueOnce({ ok: false, error: "Choose an AI provider in Settings → AI provider first." });
    open([posting("a")]);
    await user.click(screen.getByRole("button", { name: "Score" }));
    expect(toast).toHaveBeenCalledWith("Choose an AI provider in Settings → AI provider first.");
    expect(screen.getByRole("button", { name: "Score" })).toBeInTheDocument();
  });

  it("says when the scoring itself failed", async () => {
    const user = userEvent.setup();
    open([posting("a")]);
    await user.click(screen.getByRole("button", { name: "Score" }));
    await waitFor(() => expect(jobs.listeners.has("score-job")).toBe(true));
    finish({ status: "FAILED", error: "The model's answer didn't come back in the expected shape. Try again." });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("The model's answer didn't come back in the expected shape. Try again."));
    expect(screen.getByRole("button", { name: "Score" })).toBeInTheDocument();
  });
});

describe("Score in Claude (#221)", () => {
  it("opens a Claude chat that scores the posting through the connector", async () => {
    const user = userEvent.setup();
    const tab = { closed: false, opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.mocked(startScoringPosting).mockResolvedValueOnce({ ok: true, data: { handoff: "https://claude.ai/new?q=score" } });
    render(<PostingResults postings={[posting("a")]} filters={filters} total={1} more={false} empty="" today="2026-10-20T10:00:00.000Z" scoreInClaude />);
    await user.click(screen.getByRole("button", { name: "Score" }));
    expect(windowOpen).toHaveBeenCalledWith("about:blank", "_blank");
    expect(tab.location.href).toBe("https://claude.ai/new?q=score");
    expect(toast).toHaveBeenCalledWith("Scoring it in Claude. Reload this page once Claude has saved the score.");
    // Nothing is scoring here.
    expect(screen.getByRole("button", { name: "Score" })).not.toHaveAttribute("aria-disabled");
    windowOpen.mockRestore();
  });

  it("closes the waiting tab when Dossier scores it after all", async () => {
    const user = userEvent.setup();
    const tab = { closed: false, opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    render(<PostingResults postings={[posting("a")]} filters={filters} total={1} more={false} empty="" today="2026-10-20T10:00:00.000Z" scoreInClaude />);
    await user.click(screen.getByRole("button", { name: "Score" }));
    expect(tab.close).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Scoring…" })).toBeInTheDocument();
    windowOpen.mockRestore();
  });
});
