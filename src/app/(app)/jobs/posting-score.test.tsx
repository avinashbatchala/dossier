import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { PostingFit } from "@/lib/fit";
import type { JobView } from "@/lib/jobs/runner";
import type { ShownPosting } from "@/lib/job-search/search";

import { startScoringPosting } from "./actions";
import { PostingResults } from "./posting-results";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => null }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));
vi.mock("./actions", () => ({
  startApplicationFrom: vi.fn(),
  showMorePostings: vi.fn(),
  loadFullText: vi.fn(),
  savePostingForLater: vi.fn(),
  unsavePosting: vi.fn(),
  dismissFoundPosting: vi.fn(),
  restorePosting: vi.fn(),
  startScoringPosting: vi.fn(async () => ({ ok: true, data: { jobId: "score-job" } })),
}));
// The scoring job, as a test moves it along.
const jobs = vi.hoisted(() => ({ listeners: new Map<string, (job: JobView<PostingFit>) => void>() }));
vi.mock("@/hooks/use-job", () => ({
  useJob: (id: string | null, _revision: number, onChange: (job: JobView<PostingFit>) => void) => {
    if (id) jobs.listeners.set(id, onChange);
    return null;
  },
}));
const finish = (job: Partial<JobView<PostingFit>>) =>
  jobs.listeners.get("score-job")!({ id: "score-job", type: "posting-score", status: "DONE", step: null, error: null, result: null, ...job });

const fit: PostingFit = { score: 78, reasons: ["Built a design system at Northwind."], redFlags: ["Dutch is required."] };
const posting = (id: string, score: PostingFit | null = null): ShownPosting => ({
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
  state: { postingId: "row", saved: true, dismissed: false, applicationId: null, score },
});
const open = (postings: ShownPosting[]) => render(<PostingResults mode="saved" postings={postings} today="2026-10-20T10:00:00.000Z" />);

beforeEach(() => {
  vi.clearAllMocks();
  jobs.listeners.clear();
});

describe("Score in Find jobs (#208)", () => {
  it("scores the open posting in the background and shows how it fits", async () => {
    const user = userEvent.setup();
    open([posting("a")]);
    await user.click(screen.getByRole("button", { name: "Score" }));
    expect(startScoringPosting).toHaveBeenCalledWith({ posting: expect.not.objectContaining({ state: expect.anything() }) });
    expect(screen.getByRole("button", { name: "Scoring…" })).toHaveAttribute("aria-disabled", "true");

    await waitFor(() => expect(jobs.listeners.has("score-job")).toBe(true));
    finish({ status: "RUNNING", step: "Scoring it against your profile" });
    expect(await screen.findByText("Scoring it against your profile")).toHaveAttribute("role", "status");
    finish({ status: "DONE", result: fit });

    expect(await screen.findByText("Good fit · 78 of 100")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Why it fits" })).toHaveTextContent("Built a design system at Northwind.");
    expect(screen.getByText("Dutch is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Score again" })).toBeInTheDocument();
    // The list shows it too.
    expect(within(screen.getByRole("list", { name: "Postings" })).getByRole("img", { name: "Score 78 of 100" })).toBeInTheDocument();
  });

  it("shows a score it already has, in the list and the posting", () => {
    open([posting("a", { ...fit, score: 91 }), posting("b")]);
    const list = screen.getByRole("list", { name: "Postings" });
    expect(within(list).getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("Excellent fit · 91 of 100")).toBeInTheDocument();
    // Only the unscored one has a Score pill.
    expect(within(list).queryByRole("button", { name: "Score “Designer a”" })).not.toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Score “Designer b”" })).toBeInTheDocument();
  });

  it("scores a posting from its pill in the list, keeping the open one open", async () => {
    const user = userEvent.setup();
    open([posting("a"), posting("b")]);
    const list = screen.getByRole("list", { name: "Postings" });
    await user.click(within(list).getByRole("button", { name: "Score “Designer b”" }));
    expect(startScoringPosting).toHaveBeenCalledWith({ posting: expect.objectContaining({ externalId: "b" }) });
    expect(within(list).getByRole("button", { name: "Scoring… “Designer b”" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Designer a");

    await waitFor(() => expect(jobs.listeners.has("score-job")).toBe(true));
    finish({ status: "DONE", result: fit });
    expect(await within(list).findByRole("img", { name: "Score 78 of 100" })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /Designer b”$/ })).not.toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Score “Designer a”" })).toBeInTheDocument();
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
