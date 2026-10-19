import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { EMPTY_QUERY, type ShownPosting, type StoredSearch } from "@/lib/job-search/search";

import {
  dismissFoundPosting,
  loadFullText,
  removeJobSearch,
  restorePosting,
  runJobSearch,
  savePostingForLater,
  showMorePostings,
  startApplicationFrom,
  unsavePosting,
} from "./actions";
import { JobsScreen } from "./jobs-screen";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("./actions", () => ({
  startApplicationFrom: vi.fn(),
  runJobSearch: vi.fn(),
  removeJobSearch: vi.fn(),
  showMorePostings: vi.fn(),
  loadFullText: vi.fn(),
  savePostingForLater: vi.fn(),
  unsavePosting: vi.fn(),
  dismissFoundPosting: vi.fn(),
  restorePosting: vi.fn(),
}));

const countries = [
  { code: "de", name: "Germany" },
  { code: "fr", name: "France" },
];
const query = { ...EMPTY_QUERY, keywords: "product designer", place: "Hamburg", country: "de" };
const state = { postingId: null, saved: false, dismissed: false, applicationId: null };

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

const stored = (postings: ShownPosting[], next: string | null = null): StoredSearch => ({ id: "run-1", source: "JSEARCH", query, ranAt: "today at 14:32", postings, next });

const screenProps: ComponentProps<typeof JobsScreen> = {
  source: "JSEARCH",
  countries,
  view: "search",
  query,
  search: null,
  counts: { searches: 0, saved: 0, dismissed: 0 },
  today: "2026-10-03T12:00:00.000Z",
};

function renderScreen(props: Partial<ComponentProps<typeof JobsScreen>> = {}) {
  return render(<JobsScreen {...screenProps} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: true, id: "run-2" } });
  vi.mocked(removeJobSearch).mockResolvedValue({ ok: true, data: null, toast: "Search removed." });
  vi.mocked(savePostingForLater).mockResolvedValue({ ok: true, data: { postingId: "p1" } });
  vi.mocked(unsavePosting).mockResolvedValue({ ok: true, data: null });
  vi.mocked(dismissFoundPosting).mockResolvedValue({ ok: true, data: { wasSaved: false } });
  vi.mocked(restorePosting).mockResolvedValue({ ok: true, data: null });
});

describe("the search form", () => {
  it("points to Settings while job search is off", () => {
    renderScreen({ source: null });
    expect(screen.getByRole("heading", { name: "Choose where to search" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up job search" })).toHaveAttribute("href", "/settings?section=jobs");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("starts from the search it's given, and says which source it searches", () => {
    renderScreen();
    expect(screen.getByText("Search JSearch for postings near you, then start an application from the one you like.")).toBeInTheDocument();
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
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/jobs?search=run-2", { scroll: false }));
  });

  it("shows what went wrong, with Try again when the source isn't answering", async () => {
    vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: false, problem: "unavailable", message: "JSearch isn't answering right now." } });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("JSearch isn't answering right now.");
    expect(router.push).not.toHaveBeenCalled();

    vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: true, id: "run-3" } });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/jobs?search=run-3", { scroll: false }));
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
    expect(screen.getByText("That search is no longer kept. Search again, or open one from Past searches.")).toBeInTheDocument();
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

  it("says when the source doesn't cover the country", async () => {
    renderScreen({ source: "ARBEITSAGENTUR" });
    await userEvent.selectOptions(screen.getByLabelText("Country"), "fr");
    expect(screen.getByText("Bundesagentur für Arbeit doesn't list jobs in France.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(runJobSearch).not.toHaveBeenCalled();
  });

  it("warns that Adzuna can only add 'remote' to the words", async () => {
    renderScreen({ source: "ADZUNA" });
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
    renderScreen({ search: stored([posting("a", { salary: "EUR 70,000 a year", remote: true }), posting("b")], "cursor:2") });
    expect(screen.getByText("2 postings from JSearch, more to come · searched today at 14:32")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Postings" });
    const items = within(list).getAllByRole("button");
    expect(items.map((item) => item.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(items[0]).toHaveTextContent("Company a · Hamburg · Remote");
    expect(items[0]).toHaveTextContent("3 days ago · via LinkedIn · EUR 70,000 a year");
    expect(screen.getByRole("heading", { level: 2, name: "Designer a" })).toBeInTheDocument();
    expect(screen.getByText("The whole posting a.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open posting/ })).toHaveAttribute("href", "https://jobs.example/a");
    expect(screen.getByRole("link", { name: /Open posting/ })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows another posting when it's picked, and moves with the arrow keys", async () => {
    renderScreen({ search: stored([posting("a"), posting("b"), posting("c")]) });
    await userEvent.click(screen.getByRole("button", { name: /Designer b/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Designer b" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /Designer c/ })).toHaveFocus();
    expect(screen.getByRole("heading", { level: 2, name: "Designer c" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("heading", { level: 2, name: "Designer a" })).toBeInTheDocument();
  });

  it("saves a posting and takes it out of Saved again", async () => {
    renderScreen({ search: stored([posting("a")]) });
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
    renderScreen({ search: stored([posting("a", { state: { ...state, saved: true } }), posting("b")]) });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: /Designer a/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Designer b" })).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("Dismissed. It won't show in your searches.", { action: { label: "Undo", onClick: expect.any(Function) } });

    await userEvent.click(screen.getByRole("button", { name: "1 dismissed posting hidden · Show" }));
    expect(screen.getByRole("button", { name: /Designer a/ })).toHaveTextContent("Dismissed");

    vi.mocked(toast).mock.calls[0][1]!.action!.onClick();
    await waitFor(() => expect(restorePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a", saved: true }));
    expect(await screen.findByRole("heading", { level: 2, name: "Designer a" })).toBeInTheDocument();
  });

  it("brings back a dismissed posting from the list", async () => {
    renderScreen({ search: stored([posting("a", { state: { ...state, dismissed: true } })]) });
    expect(screen.getByText("You've dismissed every posting here.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1 dismissed posting hidden · Show" }));
    await userEvent.click(screen.getByRole("button", { name: "Bring back" }));
    expect(restorePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a", saved: false });
  });

  it("says when a dismiss didn't work", async () => {
    vi.mocked(dismissFoundPosting).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    renderScreen({ search: stored([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(toast).toHaveBeenCalledWith("Something went wrong on the server. Please try again.");
    expect(screen.getByRole("button", { name: /Designer a/ })).toBeInTheDocument();
  });

  it("loads the next page into the kept search, once each", async () => {
    vi.mocked(showMorePostings).mockResolvedValue({ ok: true, data: { ok: true, postings: [posting("b"), posting("c")], next: null } });
    renderScreen({ search: stored([posting("a"), posting("b")], "cursor:2") });
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(showMorePostings).toHaveBeenCalledWith({ searchId: "run-1" });
    expect(within(screen.getByRole("list", { name: "Postings" })).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("runs the same search again, as a new one", async () => {
    renderScreen({ search: stored([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Search again" }));
    expect(runJobSearch).toHaveBeenCalledWith({ query });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/jobs?search=run-2", { scroll: false }));
  });

  it("says when the next page didn't come", async () => {
    vi.mocked(showMorePostings).mockResolvedValue({ ok: true, data: { ok: false, problem: "quota", message: "No searches left." } });
    renderScreen({ search: stored([posting("a")], "cursor:2") });
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(toast).toHaveBeenCalledWith("No searches left.");
  });

  it("gets the whole text when the source only sent the start", async () => {
    vi.mocked(loadFullText).mockResolvedValue({ ok: true, data: { text: "Everything about the role." } });
    renderScreen({ search: stored([posting("a", { complete: false, description: "The start…" })]) });
    expect(screen.getByText("Getting the whole posting…")).toBeInTheDocument();
    expect(await screen.findByText("Everything about the role.")).toBeInTheDocument();
  });

  it("shows the start, and says so, when the rest can't be had", async () => {
    vi.mocked(loadFullText).mockResolvedValue({ ok: true, data: { text: null } });
    renderScreen({ search: stored([posting("a", { complete: false, description: "The start…" })]) });
    expect(await screen.findByText(/This is only the start of the posting/)).toBeInTheDocument();
    expect(screen.getByText("The start…")).toBeInTheDocument();
  });

  it("starts an application from the selected posting (E14-8)", async () => {
    vi.mocked(startApplicationFrom).mockResolvedValue({ ok: true, data: { postingId: "p 1" } });
    renderScreen({ search: stored([posting("a"), posting("b")]) });
    await userEvent.click(screen.getByRole("button", { name: /Designer b/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start application →" }));
    const { state: _ignored, ...sent } = posting("b");
    void _ignored;
    expect(startApplicationFrom).toHaveBeenCalledWith({ posting: sent });
    expect(router.push).toHaveBeenCalledWith("/new?posting=p%201");
    expect(screen.getByRole("button", { name: "Starting…" })).toHaveAttribute("aria-disabled", "true");
  });

  it("stays put when starting doesn't work", async () => {
    vi.mocked(startApplicationFrom).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    renderScreen({ search: stored([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Start application →" }));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start application →" })).toBeInTheDocument();
  });

  it("links a posting you've applied for to its application", () => {
    renderScreen({ search: stored([posting("a", { state: { ...state, applicationId: "app-1" } })]) });
    expect(within(screen.getByRole("list", { name: "Postings" })).getByText("Applied")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the application" })).toHaveAttribute("href", "/applications/app-1");
  });

  it("says when nothing was found", () => {
    renderScreen({ search: stored([]) });
    expect(screen.getByText("No postings for “product designer” within 25 km of Hamburg. Try a bigger radius or fewer words.")).toBeInTheDocument();
  });

  it("names the source's attribution when it asks for one", () => {
    renderScreen({ source: "ADZUNA", search: stored([posting("a", { source: "ADZUNA" })]) });
    expect(screen.getByText("Jobs by Adzuna")).toBeInTheDocument();
  });
});

describe("problems", () => {
  const failWith = async (problem: "key" | "quota", message: string) => {
    vi.mocked(runJobSearch).mockResolvedValue({ ok: true, data: { ok: false, problem, message } });
    renderScreen({ search: stored([posting("a")]) });
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    return screen.findByRole("alert");
  };

  it("sends key problems to Settings, in place of the results", async () => {
    expect(await failWith("key", "JSearch didn't accept your key.")).toHaveTextContent("JSearch didn't accept your key.");
    expect(screen.getByRole("link", { name: "Open Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
    expect(screen.queryByRole("list", { name: "Postings" })).not.toBeInTheDocument();
  });

  it("just says so when the quota is used up", async () => {
    const alert = await failWith("quota", "No searches left.");
    expect(alert).toHaveTextContent("No searches left.");
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("past searches (E14-10)", () => {
  const history = [
    {
      day: "Today",
      searches: [
        { id: "s1", source: "JSEARCH" as const, query: { ...query, radiusKm: 50 as const, remoteOnly: true, postedWithin: "week" as const }, found: 16, time: "14:32" },
        { id: "s2", source: "JSEARCH" as const, query: { ...query, keywords: "researcher", place: "" }, found: 1, time: "09:05" },
      ],
    },
    { day: "Mon 28 Sep", searches: [{ id: "s3", source: "ADZUNA" as const, query: { ...query, keywords: "writer" }, found: 0, time: "10:00" }] },
  ];

  it("lists them by day, each opening without asking the source again", () => {
    renderScreen({ view: "history", history, counts: { searches: 3, saved: 0, dismissed: 0 } });
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["product designer · Hamburg, 50 km · Remote only · Past week14:32 · 16 postings · JSearch", "/jobs?search=s1"],
      ["researcher · Germany09:05 · 1 posting · JSearch", "/jobs?search=s2"],
    ]);
    expect(within(screen.getByRole("region", { name: "Mon 28 Sep" })).getByRole("link")).toHaveTextContent("writer · Hamburg, 25 km10:00 · 0 postings · Adzuna");
  });

  it("removes a search", async () => {
    renderScreen({ view: "history", history });
    await userEvent.click(screen.getByRole("button", { name: "Remove the search “researcher · Germany” from 09:05" }));
    expect(removeJobSearch).toHaveBeenCalledWith({ id: "s2" });
    expect(screen.queryByRole("link", { name: /researcher/ })).not.toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("puts a search back when removing it didn't work", async () => {
    vi.mocked(removeJobSearch).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    renderScreen({ view: "history", history });
    await userEvent.click(screen.getByRole("button", { name: /Remove the search “researcher/ }));
    expect(await screen.findByRole("link", { name: /researcher/ })).toBeInTheDocument();
  });

  it("says when there are none", () => {
    renderScreen({ view: "history", history: [] });
    expect(screen.getByText(/No searches yet\. Each search you run is kept here/)).toBeInTheDocument();
  });
});

describe("the Saved and Dismissed views (E14-7)", () => {
  it("has tabs for the search, past searches and the kept postings, with how many each holds", () => {
    renderScreen({ counts: { searches: 4, saved: 3, dismissed: 1 } });
    const tabs = within(screen.getByRole("navigation", { name: "Find jobs views" })).getAllByRole("link");
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("href"), tab.getAttribute("aria-current")])).toEqual([
      ["Search", "/jobs", "page"],
      ["Past searches4", "/jobs?view=history", null],
      ["Saved3", "/jobs?view=saved", null],
      ["Dismissed1", "/jobs?view=dismissed", null],
    ]);
  });

  it("lists the saved postings, without the search form, even with job search off", () => {
    renderScreen({ source: null, view: "saved", kept: [posting("a", { state: { ...state, saved: true } })], counts: { searches: 0, saved: 1, dismissed: 0 } });
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose where to search")).not.toBeInTheDocument();
    expect(screen.getByText("1 saved posting")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Designer a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start application →" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Find jobs views" })).getByRole("link", { name: /Saved/ })).toHaveAttribute("aria-current", "page");
  });

  it("takes an unsaved posting out of Saved, with Undo", async () => {
    renderScreen({ view: "saved", kept: [posting("a", { state: { ...state, saved: true } }), posting("b", { state: { ...state, saved: true } })] });
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(unsavePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a" });
    expect(screen.queryByRole("button", { name: /Designer a/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Designer b" })).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("Removed from Saved.", { action: { label: "Undo", onClick: expect.any(Function) } });

    vi.mocked(toast).mock.calls[0][1]!.action!.onClick();
    expect(await screen.findByRole("button", { name: /Designer a/ })).toBeInTheDocument();
    expect(savePostingForLater).toHaveBeenCalled();
  });

  it("says when there's nothing saved or dismissed", () => {
    const { unmount } = renderScreen({ view: "saved", kept: [] });
    expect(screen.getByText("Nothing saved yet. Save a posting from your search results to keep it here.")).toBeInTheDocument();
    unmount();
    renderScreen({ view: "dismissed", kept: [] });
    expect(screen.getByText("Nothing dismissed. Postings you dismiss stay out of your searches and wait here.")).toBeInTheDocument();
  });

  it("brings a dismissed posting back into the searches", async () => {
    renderScreen({ view: "dismissed", kept: [posting("a", { state: { ...state, dismissed: true } })] });
    expect(screen.getByText("1 dismissed posting, kept out of your searches")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start application →" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bring back" }));
    expect(restorePosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "a", saved: false });
    expect(toast).toHaveBeenCalledWith("Brought back. It'll show in your searches again.");
    expect(screen.queryByRole("button", { name: /Designer a/ })).not.toBeInTheDocument();
  });
});
