import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { DEFAULT_FILTERS, EMPTY_QUERY, type LibraryFilters, type PostingState, type ShownPosting, type StoredSearch } from "@/lib/job-search/search";

import {
  acceptArbeitsagenturNote,
  loadLibraryPage,
  markAllPostingsSeen,
  markPostingsSeen,
  moveBackPostings,
  removeAllArchived,
  removeArchivedPostings,
  dismissFoundPosting,
  loadFullText,
  removeJobSearch,
  restorePosting,
  runJobSearch,
  savePostingForLater,
  showMorePostings,
  splitSameJob,
  startApplicationFrom,
  unsavePosting,
} from "./actions";
import { prepareAgentDraft } from "../agent/actions";
import { JobsScreen } from "./jobs-screen";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const url = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null, useSearchParams: () => new URLSearchParams(url.search) }));
vi.mock("../agent/actions", () => ({ prepareAgentDraft: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("@/hooks/use-job", () => ({ useJob: vi.fn() }));
vi.mock("./actions", () => ({
  acceptArbeitsagenturNote: vi.fn(),
  retryPortalSearch: vi.fn(),
  loadLibraryPage: vi.fn(),
  markPostingsSeen: vi.fn(),
  markAllPostingsSeen: vi.fn(),
  startApplicationFrom: vi.fn(),
  runJobSearch: vi.fn(),
  removeJobSearch: vi.fn(),
  showMorePostings: vi.fn(),
  loadFullText: vi.fn(),
  savePostingForLater: vi.fn(),
  unsavePosting: vi.fn(),
  dismissFoundPosting: vi.fn(),
  restorePosting: vi.fn(),
  splitSameJob: vi.fn(),
  moveBackPostings: vi.fn(),
  removeArchivedPostings: vi.fn(),
  removeAllArchived: vi.fn(),
}));

const countries = [
  { code: "de", name: "Germany" },
  { code: "fr", name: "France" },
];
const query = { ...EMPTY_QUERY, keywords: "product designer", place: "Hamburg", country: "de" };
const state: PostingState = { postingId: null, new: false, saved: false, dismissed: false, applicationId: null, score: null, scores: [], foundOn: [{ portal: "JSEARCH", url: "" }], archived: false, stillListedAt: null, agentSearches: [], agent: null };

const posting = (id: string, extra: Partial<ShownPosting> = {}): ShownPosting => ({
  source: "JSEARCH",
  externalId: id,
  title: `Designer ${id}`,
  company: `Company ${id}`,
  place: "Hamburg",
  remote: false,
  salary: "",
  postedAt: "2026-09-30T00:00:00.000Z",
  url: `https://jobs.example/${id}`,
  via: "LinkedIn",
  description: `The whole posting ${id}.`,
  complete: true,
  state,
  ...extra,
});

const stored = (postings: ShownPosting[], next: string | null = null): StoredSearch => ({
  id: "run-1",
  source: "JSEARCH",
  query,
  ranAt: "today at 14:32",
  postings,
  next,
  portals: [{ id: "JSEARCH", status: "done", found: postings.length, next, message: null }],
  jobId: null,
});

const screenProps: ComponentProps<typeof JobsScreen> = {
  sources: ["JSEARCH"],
  countries,
  query,
  filters: DEFAULT_FILTERS,
  library: { postings: [], total: 0, more: false },
  searches: [],
  foundSearch: null,
  counts: { open: 0, new: 0, saved: 0, applied: 0, dismissed: 0, archived: 0 },
  today: "2026-10-03T12:00:00.000Z",
};

/** What a search found: the library filtered to it (E22-5). */
const found = (postings: ShownPosting[], next: string | null = null) => ({
  library: { postings, total: postings.length, more: false },
  foundSearch: stored(postings, next),
  filters: { ...DEFAULT_FILTERS, found: "run-1" } satisfies LibraryFilters,
  counts: { open: postings.length, new: 0, saved: 0, applied: 0, dismissed: 0, archived: 0 },
});
/** The library showing one kind of posting. */
const showing = (show: LibraryFilters["show"], postings: ShownPosting[], counts: Partial<ComponentProps<typeof JobsScreen>["counts"]> = {}) => ({
  library: { postings, total: postings.length, more: false },
  filters: { ...DEFAULT_FILTERS, show },
  counts: { open: 0, new: 0, saved: 0, applied: 0, dismissed: 0, archived: 0, ...counts },
});

/** Opens a filter chip's menu and picks one of its choices (#519). */
async function choose(chip: string, option: string) {
  await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${chip}: `) }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: option }));
}

function renderScreen(props: Partial<ComponentProps<typeof JobsScreen>> = {}) {
  return render(<JobsScreen {...screenProps} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  url.search = "";
  vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: true, id: "run-2" } });
  vi.mocked(removeJobSearch).mockResolvedValue({ ok: true, data: null, toast: "Search removed." });
  vi.mocked(savePostingForLater).mockResolvedValue({ ok: true, data: { postingId: "p1" } });
  vi.mocked(unsavePosting).mockResolvedValue({ ok: true, data: null });
  vi.mocked(dismissFoundPosting).mockResolvedValue({ ok: true, data: { wasSaved: false } });
  vi.mocked(restorePosting).mockResolvedValue({ ok: true, data: null });
});

describe("the search form", () => {
  it("points to Settings while job search is off", () => {
    renderScreen({ sources: [] });
    expect(screen.getByRole("heading", { name: "Choose where to search" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up job search" })).toHaveAttribute("href", "/settings?section=jobs");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("starts from the search it's given, and says which source it searches", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Positions" })).toBeInTheDocument();
    const form = screen.getByRole("search", { name: "Search postings" });
    expect(within(form).getByLabelText("What")).toHaveValue("product designer");
    expect(within(form).getByLabelText("Where")).toHaveValue("Hamburg");
    expect(within(form).getByLabelText("Country")).toHaveValue("de");
    expect(within(form).getByLabelText("Within")).toHaveValue("25");
    expect(screen.getByText(/Search for a role, a skill or a company/)).toBeInTheDocument();
  });

  it("runs the search, which is kept, and opens it (E14-10)", async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText("Within"), "50");
    await userEvent.click(screen.getByLabelText("Remote only"));
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(runJobSearch).toHaveBeenCalledWith({ query: { ...query, radiusKm: 50, remoteOnly: true } });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/jobs?found=run-2", { scroll: false }));
  });

  it("shows what went wrong, with Try again when the source isn't answering", async () => {
    vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: false, problem: "unavailable", message: "JSearch isn't answering right now." } });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("JSearch isn't answering right now.");
    expect(router.push).not.toHaveBeenCalled();

    vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: true, id: "run-3" } });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/jobs?found=run-3", { scroll: false }));
    expect(runJobSearch).toHaveBeenCalledTimes(2);
  });

  it("toasts a failure of the action itself", async () => {
    vi.mocked(runJobSearch).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Something went wrong on the server. Please try again."));
  });

  it("says when the search in the URL is no longer kept", () => {
    renderScreen({ missingSearch: true });
    expect(screen.getByText("That search is no longer kept. Search again, or choose another under Found by.")).toBeInTheDocument();
  });

  it("asks for keywords and a country first", async () => {
    renderScreen({ query: EMPTY_QUERY });
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Type what you're looking for.")).toBeInTheDocument();
    expect(screen.getByText("Choose a country.")).toBeInTheDocument();
    expect(runJobSearch).not.toHaveBeenCalled();
    // Without a place, the radius has nothing to go by.
    expect(screen.getByLabelText("Within")).toBeDisabled();
  });

  it("has no radius for a source without one", () => {
    renderScreen({ sources: ["FREEHIRE"] });
    expect(screen.getByLabelText("Within")).toBeDisabled();
    expect(screen.getByText("FreeHire has no distance filter")).toBeInTheDocument();
  });

  it("keeps the distance while one portal switched on takes it, naming those that ignore it (#517)", () => {
    renderScreen({ sources: ["FREEHIRE", "ARBEITSAGENTUR"] });
    expect(screen.getByLabelText("Within")).toBeEnabled();
    expect(screen.getByText("FreeHire ignores the distance")).toBeInTheDocument();
  });

  it("says when the source doesn't cover the country", async () => {
    renderScreen({ sources: ["ARBEITSAGENTUR"] });
    await userEvent.selectOptions(screen.getByLabelText("Country"), "fr");
    expect(screen.getByText("Bundesagentur für Arbeit doesn't list jobs in France.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(runJobSearch).not.toHaveBeenCalled();
  });

  it("searches a country one portal switched on covers, naming those that don't (#517)", async () => {
    renderScreen({ sources: ["ARBEITSAGENTUR", "JSEARCH"] });
    await userEvent.selectOptions(screen.getByLabelText("Country"), "fr");
    expect(screen.getByText("Bundesagentur für Arbeit doesn't list jobs in France.")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).not.toHaveAttribute("aria-invalid", "true");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(runJobSearch).toHaveBeenCalled();
  });

  it("warns that Adzuna can only add 'remote' to the words", async () => {
    renderScreen({ sources: ["JSEARCH", "ADZUNA"] });
    await userEvent.click(screen.getByLabelText("Remote only"));
    expect(screen.getByText("Adzuna has no remote filter, so this adds “remote” to your search.")).toBeInTheDocument();
  });

  it("follows the URL's search on Back and forward", () => {
    const { rerender } = renderScreen();
    rerender(<JobsScreen {...screenProps} query={{ ...query, keywords: "nurse" }} />);
    expect(screen.getByLabelText("What")).toHaveValue("nurse");
  });
});

describe("the results", () => {
  it("lists the postings and shows the first one's whole text", () => {
    renderScreen({ ...found([posting("a", { salary: "EUR 70,000 a year", remote: true }), posting("b")], "cursor:2") });
    // The source bar says what was asked and when (E32-3), above the library filtered to what it found.
    const bar = within(screen.getByRole("region", { name: "Search" }));
    expect(bar.getAllByRole("listitem").map((chip) => chip.textContent)).toEqual(["product designer", "Hamburg + 25 km", "Germany", "Any time"]);
    expect(bar.getByText("Searched today at 14:32 · 2 found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More from JSearch" })).toBeInTheDocument();
    expect(screen.getByText("2 postings")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Postings" });
    const items = within(list).getAllByRole("button", { name: /^Designer/ });
    expect(items.map((item) => item.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(items[0]).toHaveTextContent("Company a · Hamburg · Remote");
    expect(items[0]).toHaveTextContent("3 days ago · LinkedIn · EUR 70,000 a year · not scored yet");
    expect(screen.getByRole("heading", { level: 2, name: "Designer a" })).toBeInTheDocument();
    expect(screen.getByText("The whole posting a.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open posting/ })).toHaveAttribute("href", "https://jobs.example/a");
    expect(screen.getByRole("link", { name: /Open posting/ })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows another posting when it's picked, and moves with the arrow keys", async () => {
    renderScreen({ ...found([posting("a"), posting("b"), posting("c")]) });
    await userEvent.click(screen.getByRole("button", { name: /^Designer b/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Designer b" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /^Designer c/ })).toHaveFocus();
    expect(screen.getByRole("heading", { level: 2, name: "Designer c" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("heading", { level: 2, name: "Designer a" })).toBeInTheDocument();
  });

  it("saves a posting and takes it out of Saved again", async () => {
    renderScreen({ ...found([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const { state: _ignored, ...sent } = posting("a");
    void _ignored;
    expect(savePostingForLater).toHaveBeenCalledWith({ posting: sent });
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("list", { name: "Postings" })).getByText("Saved")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(unsavePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a" });
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("dismisses a posting, with Undo, and can show the dismissed ones", async () => {
    vi.mocked(dismissFoundPosting).mockResolvedValue({ ok: true, data: { wasSaved: true } });
    renderScreen({ ...found([posting("a", { state: { ...state, saved: true } }), posting("b")]) });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: /^Designer a/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Designer b" })).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("Dismissed. It won't come back, from any search.", { action: { label: "Undo", onClick: expect.any(Function) } });

    vi.mocked(toast).mock.calls[0][1]!.action!.onClick();
    await waitFor(() => expect(restorePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a", saved: true }));
    expect(await screen.findByRole("heading", { level: 2, name: "Designer a" })).toBeInTheDocument();
  });

  it("brings back a dismissed posting from Dismissed", async () => {
    renderScreen({ ...showing("dismissed", [posting("a", { state: { ...state, dismissed: true } })], { dismissed: 1 }) });
    await userEvent.click(screen.getByRole("button", { name: "Bring back" }));
    expect(restorePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a", saved: false });
    expect(await screen.findByText("Nothing dismissed. Postings you dismiss never come back, from any search, and wait here.")).toBeInTheDocument();
  });

  it("says when a dismiss didn't work", async () => {
    vi.mocked(dismissFoundPosting).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    renderScreen({ ...found([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(toast).toHaveBeenCalledWith("Something went wrong on the server. Please try again.");
    expect(screen.getByRole("button", { name: /^Designer a/ })).toBeInTheDocument();
  });

  it("asks the search's portal for more, into the library", async () => {
    vi.mocked(showMorePostings).mockResolvedValue({ ok: true, data: { ok: true, postings: [posting("c")], next: null } });
    renderScreen({ ...found([posting("a"), posting("b")], "cursor:2") });
    await userEvent.click(screen.getByRole("button", { name: "More from JSearch" }));
    expect(showMorePostings).toHaveBeenCalledWith({ searchId: "run-1" });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("runs the same search again, as a new one", async () => {
    renderScreen({ ...found([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Search again" }));
    expect(runJobSearch).toHaveBeenCalledWith({ query });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/jobs?found=run-2", { scroll: false }));
  });

  it("says when the next page didn't come", async () => {
    vi.mocked(showMorePostings).mockResolvedValue({ ok: true, data: { ok: false, problem: "quota", message: "No searches left." } });
    renderScreen({ ...found([posting("a")], "cursor:2") });
    await userEvent.click(screen.getByRole("button", { name: "More from JSearch" }));
    expect(toast).toHaveBeenCalledWith("No searches left.");
  });

  it("gets the whole text when the source only sent the start", async () => {
    vi.mocked(loadFullText).mockResolvedValue({ ok: true, data: { text: "Everything about the role." } });
    renderScreen({ ...found([posting("a", { complete: false, description: "The start…" })]) });
    expect(screen.getByText("Getting the whole posting…")).toBeInTheDocument();
    expect(await screen.findByText("Everything about the role.")).toBeInTheDocument();
  });

  it("shows the start, and says so, when the rest can't be had", async () => {
    vi.mocked(loadFullText).mockResolvedValue({ ok: true, data: { text: null } });
    renderScreen({ ...found([posting("a", { complete: false, description: "The start…" })]) });
    expect(await screen.findByText(/This is only the start of the posting/)).toBeInTheDocument();
    expect(screen.getByText("The start…")).toBeInTheDocument();
  });

  it("opens on the posting Jump to asked for (E27-6)", () => {
    url.search = "show=saved&focus=JSEARCH%3Ab";
    const saved = { ...state, saved: true };
    renderScreen({ ...showing("saved", [posting("a", { state: saved }), posting("b", { state: saved })]) });
    expect(screen.getByRole("button", { name: /^Designer b/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Designer a/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("starts an application from the selected posting (E14-8)", async () => {
    vi.mocked(startApplicationFrom).mockResolvedValue({ ok: true, data: { postingId: "p 1" } });
    renderScreen({ ...found([posting("a"), posting("b")]) });
    await userEvent.click(screen.getByRole("button", { name: /^Designer b/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start application →" }));
    const { state: _ignored, ...sent } = posting("b");
    void _ignored;
    expect(startApplicationFrom).toHaveBeenCalledWith({ posting: sent });
    expect(router.push).toHaveBeenCalledWith("/new?posting=p%201");
    expect(screen.getByRole("button", { name: "Starting…" })).toHaveAttribute("aria-disabled", "true");
  });

  it("stays put when starting doesn't work", async () => {
    vi.mocked(startApplicationFrom).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    renderScreen({ ...found([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Start application →" }));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start application →" })).toBeInTheDocument();
  });

  it("links a posting you've applied for to its application", () => {
    renderScreen({ ...found([posting("a", { state: { ...state, applicationId: "app-1" } })]) });
    expect(within(screen.getByRole("list", { name: "Postings" })).getByText("Applied")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the application" })).toHaveAttribute("href", "/applications/app-1");
  });

  it("says when nothing was found", () => {
    renderScreen({ ...found([]) });
    expect(screen.getByText("No postings for “product designer” within 25 km of Hamburg. Try a bigger radius or fewer words.")).toBeInTheDocument();
  });

  it("says when nothing was found on a source without a radius", () => {
    renderScreen({ sources: ["FREEHIRE"], ...found([]), foundSearch: { ...stored([]), source: "FREEHIRE" } });
    expect(screen.getByText("No postings for “product designer” in Hamburg. Try fewer words.")).toBeInTheDocument();
  });

  it("labels each of Adzuna's postings with a link to its site for the posting's country, as its terms ask", () => {
    const url = "https://www.adzuna.de/land/ad/4721394012?se=abc&utm_medium=api&utm_source=dossier&v=1";
    renderScreen({ sources: ["ADZUNA"], ...found([posting("a", { source: "ADZUNA", url }), posting("b", { source: "ADZUNA", url })]) });
    const labels = screen.getAllByRole("link", { name: "Jobs by Adzuna (opens in a new tab)" });
    // One on each card and one on the posting shown.
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label).toHaveAttribute("href", "https://www.adzuna.de");
      expect(label).toHaveAttribute("target", "_blank");
    }
  });

  it("names the Bundesagentur für Arbeit in plain text, on the posting only", () => {
    renderScreen({ sources: ["ARBEITSAGENTUR"], ...found([posting("a", { source: "ARBEITSAGENTUR" })]) });
    expect(screen.getAllByText("Source: Bundesagentur für Arbeit")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /Source: Bundesagentur/ })).not.toBeInTheDocument();
  });
});

describe("problems", () => {
  const failWith = async (problem: "key" | "quota", message: string) => {
    vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: false, problem, message } });
    renderScreen({ ...found([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Search again" }));
    return screen.findByRole("alert");
  };

  it("sends key problems to Settings, above what earlier searches found", async () => {
    expect(await failWith("key", "JSearch didn't accept your key.")).toHaveTextContent("JSearch didn't accept your key.");
    expect(screen.getByRole("link", { name: "Open Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
    expect(screen.getByRole("list", { name: "Postings" })).toBeInTheDocument();
  });

  it("just says so when the quota is used up", async () => {
    const alert = await failWith("quota", "No searches left.");
    expect(alert).toHaveTextContent("No searches left.");
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the Bundesagentur für Arbeit (#223)", () => {
  it("shows its note above the search until it's ticked", async () => {
    vi.mocked(acceptArbeitsagenturNote).mockResolvedValue({ ok: true, data: null });
    renderScreen({ sources: ["ARBEITSAGENTUR"], arbeitsagenturNote: true });
    expect(screen.getByRole("note")).toHaveTextContent(/has no official API.*on your own responsibility/);
    await userEvent.click(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" }));
    expect(acceptArbeitsagenturNote).toHaveBeenCalledWith({});
    expect(router.refresh).toHaveBeenCalled();
  });

  it("leaves the note out once it's accepted, and for other sources", () => {
    renderScreen({ sources: ["ARBEITSAGENTUR"] });
    expect(screen.queryByRole("checkbox", { name: /I understand/ })).not.toBeInTheDocument();
  });

  it("links each posting to its ad on arbeitsagentur.de, next to the employer's own link", () => {
    const ba = posting("10000-1234-S", { source: "ARBEITSAGENTUR", url: "https://careers.example/1" });
    renderScreen({ sources: ["ARBEITSAGENTUR"], ...found([ba]) });
    expect(screen.getByRole("link", { name: /Open posting/ })).toHaveAttribute("href", "https://careers.example/1");
    expect(screen.getByRole("link", { name: /On arbeitsagentur\.de/ })).toHaveAttribute("href", "https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1234-S");
  });

  it("has one link when the posting's own link is its ad", () => {
    const ba = posting("10000-1234-S", { source: "ARBEITSAGENTUR", url: "https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-1234-S" });
    renderScreen({ sources: ["ARBEITSAGENTUR"], ...found([ba]) });
    expect(screen.queryByRole("link", { name: /On arbeitsagentur\.de/ })).not.toBeInTheDocument();
  });
});

describe("the positions library (E22-5)", () => {
  it("has tabs with how many each holds, the Archive last, and the filters as chips (E32-3)", () => {
    renderScreen({ counts: { open: 12, new: 3, saved: 2, applied: 1, dismissed: 1, archived: 4 } });
    const tabs = within(screen.getByRole("navigation", { name: "Where they stand" })).getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["All open 12", "New 3", "Saved 2", "Applied for 1", "Dismissed 1", "Archive 4"]);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(tabs[2]).toHaveAttribute("href", "/jobs?show=saved");
    expect(tabs[5]).toHaveAttribute("href", "/jobs?tab=archive");
    for (const label of ["Found by", "Portal", "Posted within", "Covers", "Sort"]) expect(screen.getByRole("button", { name: new RegExp(`^${label}: `) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Covers: any" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort: Best fit" })).toBeInTheDocument();
  });

  it("filters by search, portal, age and score, each a new address", async () => {
    const days = [{ day: "Today", searches: [{ id: "run-1", source: "JSEARCH", query, found: 4, time: "14:32" }] }];
    renderScreen({ searches: days });
    await userEvent.click(screen.getByRole("button", { name: /^Found by: / }));
    expect(screen.getByRole("menuitemradio", { name: /product designer · Hamburg, 25 km · Today 14:32/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Today 14:32/ }));
    expect(router.push).toHaveBeenLastCalledWith("/jobs?found=run-1", { scroll: false });
    await choose("Portal", "Adzuna");
    expect(router.push).toHaveBeenLastCalledWith("/jobs?portal=ADZUNA", { scroll: false });
    await choose("Posted within", "past week");
    expect(router.push).toHaveBeenLastCalledWith("/jobs?age=week", { scroll: false });
    await choose("Covers", "at least half");
    expect(router.push).toHaveBeenLastCalledWith("/jobs?covers=half", { scroll: false });
    await choose("Sort", "Newest");
    expect(router.push).toHaveBeenLastCalledWith("/jobs?sort=new", { scroll: false });
  });

  it("marks a new posting, which stops being new once it's opened", async () => {
    const fresh = (id: string, postingId: string) => posting(id, { state: { ...state, new: true, postingId } });
    renderScreen({ library: { postings: [fresh("a", "p-a"), fresh("b", "p-b")], total: 2, more: false }, counts: { open: 2, new: 2, saved: 0, applied: 0, dismissed: 0, archived: 0 } });
    const second = screen.getByRole("button", { name: /^Designer b/ });
    expect(second).toHaveTextContent("New");
    // Shown first on its own, a posting isn't opened yet.
    expect(markPostingsSeen).not.toHaveBeenCalled();
    await userEvent.click(second);
    expect(markPostingsSeen).toHaveBeenCalledWith({ postingIds: ["p-b"] });
    expect(screen.getByRole("button", { name: /^Designer b/ })).not.toHaveTextContent("New");
  });

  it("marks all as seen", async () => {
    vi.mocked(markAllPostingsSeen).mockResolvedValue({ ok: true, data: { count: 3 } });
    renderScreen({ counts: { open: 3, new: 3, saved: 0, applied: 0, dismissed: 0, archived: 0 } });
    await userEvent.click(screen.getByRole("button", { name: "Mark all as seen" }));
    expect(markAllPostingsSeen).toHaveBeenCalledWith({ filters: DEFAULT_FILTERS });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("loads the library's next page through the same filters", async () => {
    vi.mocked(loadLibraryPage).mockResolvedValue({ ok: true, data: { postings: [posting("c")], more: false } });
    renderScreen({ library: { postings: [posting("a"), posting("b")], total: 3, more: true } });
    expect(screen.getByText("3 postings, showing 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(loadLibraryPage).toHaveBeenCalledWith({ filters: DEFAULT_FILTERS, offset: 2 });
    expect(await screen.findByRole("button", { name: /^Designer c/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("removes a search; what it found stays", async () => {
    renderScreen({ ...found([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Remove this search" }));
    expect(removeJobSearch).toHaveBeenCalledWith({ id: "run-1" });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/jobs", { scroll: false }));
  });

  it("lists saved postings even with every portal off", () => {
    renderScreen({ sources: [], ...showing("saved", [posting("a", { state: { ...state, saved: true } })], { saved: 1 }) });
    expect(screen.getByRole("heading", { name: "Choose where to search" })).toBeInTheDocument();
    expect(screen.getByText("1 saved posting")).toBeInTheDocument();
  });

  it("takes an unsaved posting out of Saved, with Undo", async () => {
    renderScreen({ ...showing("saved", [posting("a", { state: { ...state, saved: true } }), posting("b", { state: { ...state, saved: true } })], { saved: 2 }) });
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(unsavePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a" });
    expect(screen.queryByRole("button", { name: /^Designer a/ })).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("Removed from Saved.", { action: { label: "Undo", onClick: expect.any(Function) } });
  });

  it("says when there's nothing saved, dismissed, new or found", () => {
    const { unmount } = renderScreen({ ...showing("saved", []) });
    expect(screen.getByText("Nothing saved yet. Save a posting to keep it here.")).toBeInTheDocument();
    unmount();
    const second = renderScreen({ ...showing("new", []) });
    expect(screen.getByText("Nothing new. Every posting here has been opened.")).toBeInTheDocument();
    second.unmount();
    renderScreen();
    expect(screen.getByText(/Every posting a search finds lands here, once/)).toBeInTheDocument();
  });});

describe("the same job on several portals (E22-6)", () => {
  const foundOn = [
    { portal: "JSEARCH", url: "https://www.linkedin.com/jobs/view/1" },
    { portal: "ADZUNA", url: "https://www.adzuna.de/details/2" },
    { portal: "FREEHIRE", url: "https://careers.northwind.example/jobs/3" },
  ];
  const twice = posting("a", { url: foundOn[0].url, state: { ...state, postingId: "p-a", foundOn } });

  it("shows a posting once, saying which other portals found it, each with its link", () => {
    renderScreen({ library: { postings: [twice], total: 1, more: false } });
    expect(screen.getByRole("button", { name: /^Designer a/ })).toHaveTextContent(/Adzuna and FreeHire/);
    const line = screen.getByText(/Found on/);
    expect(line).toHaveTextContent(/^Found on JSearch.*, Adzuna.* and FreeHire.*, as the same job\. Not the same job$/);
    expect(within(line).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(foundOn.map((entry) => entry.url));
  });

  it("opens the employer's own link when one of the portals has it", () => {
    renderScreen({ library: { postings: [twice], total: 1, more: false } });
    expect(screen.getByRole("link", { name: /^Open posting/ })).toHaveAttribute("href", foundOn[2].url);
  });

  it("shows them apart again on Not the same job", async () => {
    vi.mocked(splitSameJob).mockResolvedValue({ ok: true, data: { count: 2 } });
    renderScreen({ library: { postings: [twice], total: 1, more: false } });
    await userEvent.click(screen.getByRole("button", { name: "Not the same job" }));
    expect(splitSameJob).toHaveBeenCalledWith({ postingId: "p-a" });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("has no Not the same job for a posting found on one portal", () => {
    renderScreen({ library: { postings: [posting("b")], total: 1, more: false } });
    expect(screen.queryByRole("button", { name: "Not the same job" })).not.toBeInTheDocument();
  });
});

describe("the Archive (E22-7)", () => {
  const archived = (id: string, extra: Partial<PostingState> = {}) => posting(id, { state: { ...state, postingId: `p-${id}`, new: true, archived: true, ...extra } });
  const inArchive = (postings: ShownPosting[]) => ({
    library: { postings, total: postings.length, more: false },
    filters: { ...DEFAULT_FILTERS, tab: "archive" as const },
    counts: { open: 4, new: 1, saved: 0, applied: 0, dismissed: 0, archived: postings.length },
    archiveDays: 60,
  });

  it("is the last tab, with how many it holds and when postings move there (PL2)", () => {
    renderScreen(inArchive([archived("a"), archived("b")]));
    const tabs = screen.getByRole("navigation", { name: "Where they stand" });
    expect(within(tabs).getByRole("link", { name: /Archive/ })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: /Archive/ })).toHaveTextContent("2");
    expect(within(tabs).getByRole("link", { name: /^All open/ })).toHaveAttribute("href", "/jobs");
    expect(screen.getByText(/move here 60 days after a search last found them/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change the days" })).toHaveAttribute("href", "/settings?section=jobs");
  });

  it("marks one a search found again as still listed, and nothing as new", () => {
    renderScreen(inArchive([archived("a", { stillListedAt: "2026-10-03T08:00:00.000Z" }), archived("b")]));
    expect(screen.getByRole("button", { name: /^Designer a/ })).toHaveTextContent("Still listed · Today");
    expect(screen.getByRole("button", { name: /^Designer b/ })).not.toHaveTextContent("New");
  });

  it("moves back or removes the posting shown", async () => {
    vi.mocked(moveBackPostings).mockResolvedValue({ ok: true, data: { count: 1 } });
    vi.mocked(removeArchivedPostings).mockResolvedValue({ ok: true, data: { count: 1 } });
    renderScreen(inArchive([archived("a"), archived("b")]));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move back" }));
    expect(moveBackPostings).toHaveBeenCalledWith({ postingIds: ["p-a"] });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Designer a/ })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeArchivedPostings).toHaveBeenCalledWith({ postingIds: ["p-b"] });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("moves back or removes those selected", async () => {
    vi.mocked(removeArchivedPostings).mockResolvedValue({ ok: true, data: { count: 2 } });
    renderScreen(inArchive([archived("a"), archived("b"), archived("c")]));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Designer a”" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select “Designer c”" }));
    expect(screen.getByRole("checkbox", { name: "2 selected" })).toBePartiallyChecked();
    const bar = screen.getByRole("checkbox", { name: "2 selected" }).closest("div.flex-wrap") as HTMLElement;
    await userEvent.click(within(bar).getByRole("button", { name: "Remove" }));
    expect(removeArchivedPostings).toHaveBeenCalledWith({ postingIds: ["p-a", "p-c"] });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Designer/ })).toHaveLength(1));
  });

  it("removes all it shows once that's confirmed", async () => {
    vi.mocked(removeAllArchived).mockResolvedValue({ ok: true, data: { count: 2 } });
    renderScreen(inArchive([archived("a"), archived("b")]));
    await userEvent.click(screen.getByRole("button", { name: "Remove all" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove all 2 postings in the Archive?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(removeAllArchived).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove all" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove all" }));
    expect(removeAllArchived).toHaveBeenCalledWith({ filters: { ...DEFAULT_FILTERS, tab: "archive" } });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("says when it's empty", () => {
    renderScreen(inArchive([]));
    expect(screen.getByText("Nothing in the Archive. A posting you don't save, apply for or dismiss moves here 60 days after a search last found it.")).toBeInTheDocument();
  });
});

describe("what the job agent found (E22-8)", () => {
  const byAgent = (id: string, agent: PostingState["agent"]) => posting(id, { state: { ...state, postingId: `p-${id}`, agentSearches: ["Designers in Hamburg"], agent } });

  it("is a choice under Found by", async () => {
    renderScreen();
    await choose("Found by", "the job agent");
    expect(router.push).toHaveBeenLastCalledWith("/jobs?found=agent", { scroll: false });
  });

  it("says which of its searches found a posting", () => {
    renderScreen({ library: { postings: [byAgent("a", null)], total: 1, more: false } });
    expect(screen.getByRole("button", { name: /^Designer a/ })).toHaveTextContent("Found by the agent · Designers in Hamburg");
  });

  it("prepares a draft from a posting it scored, and links to one it wrote", async () => {
    vi.mocked(prepareAgentDraft).mockResolvedValue({ ok: true, data: { jobId: "draft-job", applicationId: null } });
    const scored = byAgent("a", { candidateId: "c-a", status: "SCORED", applicationId: null });
    const drafted = byAgent("b", { candidateId: "c-b", status: "DRAFTED", applicationId: "app-b" });
    renderScreen({ library: { postings: [scored, drafted], total: 2, more: false } });
    await userEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
    expect(prepareAgentDraft).toHaveBeenCalledWith({ candidateId: "c-a" });
    expect(await screen.findByRole("button", { name: "Preparing draft…" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Designer b/ }));
    expect(screen.getByRole("link", { name: "Review the draft" })).toHaveAttribute("href", "/applications/app-b");
  });

  it("says when it found nothing yet", () => {
    renderScreen({ filters: { ...DEFAULT_FILTERS, found: "agent" }, counts: { open: 3, new: 0, saved: 0, applied: 0, dismissed: 0, archived: 0 } });
    expect(screen.getByText("Nothing from the job agent here yet. What its runs find lands here, best first.")).toBeInTheDocument();
  });
});
