import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { JobView } from "@/lib/jobs/runner";

import { cancel } from "@/lib/jobs/actions";

import { addGapSkill, addSentApplication, fetchPostingText, handOffToClaude, savePostingForLater, startReadingPosting, startScoringPosting, startWritingApplication } from "./actions";
import { NewApplication } from "./new-application";

vi.mock("./actions", () => ({
  startReadingPosting: vi.fn(),
  startScoringPosting: vi.fn(),
  startWritingApplication: vi.fn(),
  savePostingForLater: vi.fn(),
  addGapSkill: vi.fn(),
  fetchPostingText: vi.fn(),
  handOffToClaude: vi.fn(),
  addSentApplication: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ retry: vi.fn(async () => ({ ok: true, data: null })), cancel: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
// Jobs follow whatever the test says, as the real hook would: new state, then onChange.
const jobs = vi.hoisted(() => ({ listeners: new Map<string, (job: unknown) => void>() }));
vi.mock("@/hooks/use-job", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useJob: vi.fn((id: string | null, _revision: number, onChange?: (job: unknown) => void) => {
      const [view, setView] = useState<{ id: string } | null>(null);
      useEffect(() => {
        if (!id) return;
        jobs.listeners.set(id, (job) => {
          setView(job as { id: string });
          onChange?.(job);
        });
      });
      return view && view.id === id ? view : null;
    }),
  };
});
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
// The URL as the page left it with pushState (E31-1).
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null, useSearchParams: () => new URLSearchParams(window.location.search) }));

const props = { aiReady: true, samplePosting: "Ledgerly is hiring a Senior Product Designer.", defaultTone: "WARM" as const };

function emit(job: Partial<JobView>) {
  const view = { id: "job-1", type: "read-posting", status: "RUNNING", step: null, error: null, result: null, ...job };
  act(() => jobs.listeners.get(view.id)?.(view));
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/new");
  vi.mocked(toast).mockReset();
  vi.mocked(startReadingPosting).mockReset().mockResolvedValue({ ok: true, data: "job-1" });
  router.push.mockReset();
  router.replace.mockReset();
  vi.mocked(startWritingApplication).mockReset();
});

describe("the paste step (E7-1)", () => {
  it("asks what it's for, with one box for the posting, its link and Read the posting (E31-2)", () => {
    render(<NewApplication {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "What are you applying for?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Job posting")).toHaveAttribute("placeholder", "Paste the job posting here: the whole text, as it appears.");
    expect(screen.getByLabelText("Link to the posting")).toHaveAttribute("placeholder", "Or a link to it · optional");
    expect(screen.getByRole("button", { name: "Add it to keep track" })).toBeInTheDocument();
    // Nothing about AI providers while one is set up.
    expect(screen.queryByText(/No AI provider yet/)).not.toBeInTheDocument();
  });

  it("offers saved postings and agent finds to start from, with their coverage (E31-2)", () => {
    render(
      <NewApplication
        {...props}
        startFrom={[{ id: "p1", title: "UX Designer", company: "Tulip Health", place: "Remote", salary: "", hit: 4, total: 6, from: "saved", when: "Saved · yesterday" }]}
      />,
    );
    const saved = within(screen.getByRole("region", { name: "Or start from one you saved" }));
    expect(saved.getByText("Tulip Health · Remote")).toBeInTheDocument();
    expect(saved.getByText("4/6")).toBeInTheDocument();
    expect(saved.getByRole("link", { name: "Start UX Designer at Tulip Health" })).toHaveAttribute("href", "/new?posting=p1");
  });

  it("stays focusable but explains itself while there's no posting", async () => {
    render(<NewApplication {...props} />);
    const read = screen.getByRole("button", { name: "Read the posting" });
    expect(read).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(read);
    expect(toast).toHaveBeenCalledWith("Paste a job posting first, or try the sample.");
    expect(startReadingPosting).not.toHaveBeenCalled();
  });

  it("offers the sample only when there is one", async () => {
    const { unmount } = render(<NewApplication {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Use a sample posting" }));
    expect(screen.getByLabelText("Job posting")).toHaveValue(props.samplePosting);
    unmount();
    // Another tab, with nothing kept.
    sessionStorage.clear();
    render(<NewApplication {...props} samplePosting={null} />);
    expect(screen.queryByRole("button", { name: "Use a sample posting" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    expect(toast).toHaveBeenCalledWith("Paste a job posting first.");
  });

  it("fetches the posting from its link, with a way back to what was there (E7-8)", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPostingText).mockResolvedValueOnce({ ok: true, data: { text: "Ledgerly: Senior Designer\n\nWhat you'll do…", url: "https://www.jobs.ledgerly.example/123", doubtful: false } });
    render(<NewApplication {...props} />);
    // Fetch shows once there's a link.
    expect(screen.queryByRole("button", { name: "Fetch" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Job posting"), "My own notes");
    await user.type(screen.getByLabelText(/^Link to the posting/), "jobs.ledgerly.example/123");
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(fetchPostingText).toHaveBeenCalledWith({ link: "jobs.ledgerly.example/123" });
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly: Senior Designer\n\nWhat you'll do…");
    expect(toast).toHaveBeenCalledWith("Fetched the posting from jobs.ledgerly.example. Check it before reading it.", {
      action: { label: "Undo", onClick: expect.any(Function) },
    });
    act(() => vi.mocked(toast).mock.calls.at(-1)![1]!.action!.onClick());
    expect(screen.getByLabelText("Job posting")).toHaveValue("My own notes");
  });

  it("warns when what came back looks like menus or links, and fills the box all the same (#232)", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPostingText).mockResolvedValueOnce({ ok: true, data: { text: "Jobs\nCompanies\nSalaries", url: "https://jobs.example/123", doubtful: true } });
    render(<NewApplication {...props} />);
    await user.type(screen.getByLabelText(/^Link to the posting/), "jobs.example/123");
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(screen.getByLabelText("Job posting")).toHaveValue("Jobs\nCompanies\nSalaries");
    expect(toast).toHaveBeenCalledWith("What came back from jobs.example looks like menus or links, not a job posting. Check it, or paste the posting instead.", {});
  });

  it("adds one already sent, without documents or the AI (public #129)", async () => {
    const user = userEvent.setup();
    render(<NewApplication {...props} aiReady={false} />);
    await user.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await user.type(screen.getByLabelText(/^Link to the posting/), "https://jobs.example/ledgerly");
    await user.click(screen.getByRole("button", { name: "Add it to keep track" }));
    const form = within(screen.getByRole("form", { name: "Already sent" }));
    expect(form.getByRole("button", { name: "Add application" })).toHaveAttribute("aria-disabled", "true");
    await user.type(form.getByLabelText("Company"), "Ledgerly");
    await user.type(form.getByLabelText("Role"), "Designer");
    await user.clear(form.getByLabelText("Sent on"));
    await user.type(form.getByLabelText("Sent on"), "2026-09-01");
    await user.selectOptions(form.getByLabelText("Where it stands"), "Interview");

    vi.mocked(addSentApplication).mockResolvedValueOnce({ ok: true, data: "app-9" });
    await user.click(form.getByRole("button", { name: "Add application" }));
    expect(addSentApplication).toHaveBeenCalledWith({
      posting: "Ledgerly is hiring.",
      postingUrl: "https://jobs.example/ledgerly",
      profileId: undefined,
      postingId: null,
      startupId: null,
      company: "Ledgerly",
      role: "Designer",
      sentOn: "2026-09-01",
      status: "INTERVIEW",
    });
    expect(router.push).toHaveBeenCalledWith("/applications/app-9");
    expect(startReadingPosting).not.toHaveBeenCalled();
  });

  it("points to Settings and the Claude connector when no AI provider is set up", async () => {
    render(<NewApplication {...props} aiReady={false} />);
    expect(screen.getByRole("link", { name: "Choose one" })).toHaveAttribute("href", "/settings?section=ai");
    expect(screen.getByRole("link", { name: "write it with Claude" })).toHaveAttribute("href", "/settings?section=connector");
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    expect(toast).toHaveBeenCalledWith("Choose an AI provider in Settings first, or write it with Claude.");
    expect(startReadingPosting).not.toHaveBeenCalled();
  });

  it("hands the posting to a Claude chat when the connector is on and Dossier has no model (#221)", async () => {
    const tab = { closed: false, opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.mocked(handOffToClaude).mockResolvedValue({ ok: true, data: { url: "https://claude.ai/new?q=write" } });
    render(<NewApplication {...props} aiReady={false} writeInClaude />);
    expect(screen.getByRole("link", { name: "Choose a model" })).toHaveAttribute("href", "/settings?section=ai");
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.type(screen.getByLabelText(/^Link to the posting/), "https://jobs.example/1");
    await userEvent.click(screen.getByRole("button", { name: "Write it with Claude" }));
    // The tab opens during the click, then goes to the chat.
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(handOffToClaude).toHaveBeenCalledWith({ posting: "Ledgerly is hiring.", postingUrl: "https://jobs.example/1" });
    expect(tab.location.href).toBe("https://claude.ai/new?q=write");
    expect(tab.opener).toBeNull();
    expect(startReadingPosting).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Writing it in Claude. It shows up under Applications as a Draft once Claude has saved it.");
    open.mockRestore();
  });

  it("asks which profile to use when there are several, and reads the posting for it (E24-6)", async () => {
    const profiles = [
      { id: "first", name: "Design" },
      { id: "backend", name: "Backend" },
    ];
    const { unmount } = render(<NewApplication {...props} profiles={profiles} defaultProfileId="first" />);
    expect(screen.getByLabelText("Write from")).toHaveValue("first");
    await userEvent.selectOptions(screen.getByLabelText("Write from"), "backend");
    await userEvent.type(screen.getByLabelText("Job posting"), "Acme is hiring a Go engineer.");
    // The choice is kept with the rest of the draft.
    unmount();
    render(<NewApplication {...props} profiles={profiles} defaultProfileId="first" />);
    expect(screen.getByLabelText("Write from")).toHaveValue("backend");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    expect(startReadingPosting).toHaveBeenCalledWith({ posting: "Acme is hiring a Go engineer.", profileId: "backend", postingId: null });
  });

  it("doesn't ask with one profile", () => {
    render(<NewApplication {...props} profiles={[{ id: "first", name: "Design" }]} defaultProfileId="first" />);
    expect(screen.queryByLabelText("Write from")).not.toBeInTheDocument();
  });
});

describe("the reading step (E7-2)", () => {
  async function startReading() {
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
  }

  it("shows the job's own steps as they happen", async () => {
    await startReading();
    expect(startReadingPosting).toHaveBeenCalledWith({ posting: "Ledgerly is hiring.", postingId: null });
    expect(screen.getByRole("heading", { name: "Reading the posting…" })).toBeInTheDocument();
    emit({ step: "Picking out the role, company and requirements" });
    expect(screen.getByText("Picking out the role, company and requirements").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("This can take a little longer on a local model.")).toBeInTheDocument();
  });

  it("offers Retry and a way back with the text intact when it fails", async () => {
    await startReading();
    emit({ status: "FAILED", step: "Reading the posting", error: "Couldn't reach the server. Check the address and that it's running." });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "← Back to the posting" }));
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly is hiring.");
  });

  it("moves on to the review in the application's frame when the job is done (E31-3)", async () => {
    await startReading();
    emit({
      status: "DONE",
      step: "Comparing it with your profile",
      result: {
        extracted: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
        extractedWith: "extract-posting@1",
        match: { items: [] },
        matchedWith: "match-requirements@1",
      },
    });
    expect(screen.getByRole("heading", { level: 1, name: "Designer at Ledgerly" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Application" })).getByText("Before writing")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("heading", { name: "What I read from the posting" })).toBeInTheDocument();
  });
});

describe("the review (E31-3)", () => {
  const read = {
    extracted: {
      title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: "Amsterdam", mode: null, salary: null, deadline: null,
      requirements: [
        { text: "5+ years of product design", kind: "years", skill: null, years: 5, language: null },
        { text: "Accessibility know-how", kind: "skill", skill: "Accessibility", years: null, language: null },
        { text: "Strong prototyping in Figma", kind: "skill", skill: "Figma", years: null, language: null },
        { text: "Experience with payments", kind: "other", skill: null, years: null, language: null },
      ],
      asksForReferences: false, language: "English",
    },
    extractedWith: "extract-posting@1",
    match: {
      items: [
        { requirement: "5+ years of product design", result: "covered", skill: null, experienceIds: [], note: "3 roles in your profile, since Sep 2015" },
        { requirement: "Accessibility know-how", result: "gap", skill: null, experienceIds: [], note: null, addable: "Accessibility" },
        { requirement: "Strong prototyping in Figma", result: "partial", skill: "Figma", experienceIds: [], note: "In your skills, but not linked to a role yet" },
        { requirement: "Experience with payments", result: "gap", skill: null, experienceIds: [], note: null },
      ],
    },
    matchedWith: "match-requirements@1",
    fit: { score: 69, reasons: ["Five years of design."], redFlags: [] },
  };
  const posting = "Ledgerly is hiring.\n- 5+ years of product design\n- Experience with payments";

  async function review(extra: Partial<Parameters<typeof NewApplication>[0]> = {}) {
    render(<NewApplication {...props} {...extra} />);
    await userEvent.type(screen.getByLabelText("Job posting"), posting);
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    emit({ status: "DONE", result: read });
  }

  it("shows what was read, and leaves what the posting doesn't say empty; Edit makes it fields", async () => {
    await review();
    const readOut = within(screen.getByRole("region", { name: "What I read from the posting" }));
    expect(readOut.getByText("Company").nextSibling).toHaveTextContent("Ledgerly");
    expect(readOut.getByText("Salary").nextSibling).toHaveTextContent("Not in the posting");
    await userEvent.click(screen.getByRole("button", { name: "Edit what I read" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Designer · Ledgerly");
    await userEvent.clear(screen.getByLabelText("Company"));
    await userEvent.type(screen.getByLabelText("Company"), "Ledgerly B.V.");
    await userEvent.type(screen.getByLabelText("Apply by"), "2026-10-15");
    await userEvent.click(readOut.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("heading", { level: 1, name: "Designer at Ledgerly B.V." })).toBeInTheDocument();
  });

  it("fills the Fit column from the reading: coverage, each requirement, and the score folded away", async () => {
    await review({ profiles: [{ id: "first", name: "Design" }, { id: "backend", name: "Backend" }], defaultProfileId: "first" });
    const fit = within(screen.getAllByRole("complementary", { name: "How you fit" })[0]);
    expect(fit.getByText("2 of 4 covered by Design")).toBeInTheDocument();
    expect(fit.getByText("5+ years of product design")).toBeInTheDocument();
    expect(fit.getByText("3 roles in your profile, since Sep 2015")).toBeInTheDocument();
    expect(fit.getByText(/^Gaps aren't dealbreakers\./)).toBeInTheDocument();
    expect(fit.getByText("How it fits, in more ways · Why?")).toBeInTheDocument();
  });

  it("says why How you fit waits when the profile's levels aren't chosen, and still lets you write (#518)", async () => {
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), posting);
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    const message = "Set the levels for “My profile” first. Choose them in Profile → Jobs it's for.";
    emit({ status: "DONE", result: { ...read, match: { items: [] }, matchedWith: "", fit: undefined, scoreWaits: { message, href: "/profile?section=target&profile=first" } } });
    const fit = within(screen.getAllByRole("complementary", { name: "How you fit" })[0]);
    expect(fit.getByRole("note")).toHaveTextContent(`How you fit waits: ${message}`);
    expect(fit.getByRole("link", { name: "Choose the levels" })).toHaveAttribute("href", "/profile?section=target&profile=first");
    expect(fit.queryByText("No requirements found")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What I read from the posting" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Write resume and letter/ })[0]).not.toHaveAttribute("aria-disabled");
  });

  it("scores the posting again on request (public issue 66)", async () => {
    vi.mocked(startScoringPosting).mockResolvedValue({ ok: true, data: "score-1" });
    await review();
    const fit = within(screen.getAllByRole("complementary", { name: "How you fit" })[0]);
    await userEvent.click(fit.getByText("How it fits, in more ways · Why?"));
    await userEvent.click(fit.getByRole("button", { name: "Score it again" }));
    expect(startScoringPosting).toHaveBeenCalledWith({ posting, details: { title: "Designer · Ledgerly", company: "Ledgerly", location: "Amsterdam", mode: "", salary: "" } });
    emit({ id: "score-1", type: "pasted-score", status: "DONE", result: { score: 78, reasons: ["Built a design system."], redFlags: ["Dutch is required."] } });
    // The new score's reasons, never its number (E32-2).
    expect(fit.getByText("Dutch is required.")).toBeInTheDocument();
  });

  it("shows the posting with each requirement marked where it says it, numbered as in the column", async () => {
    await review();
    await userEvent.click(screen.getByRole("button", { name: "Show the posting" }));
    const marks = screen.getByRole("region", { name: /^The posting · \d+ words$/ }).querySelectorAll("mark");
    expect([...marks].map((mark) => mark.textContent)).toEqual(["(covered) 5+ years of product design", "(a gap) Experience with payments"]);
    expect(marks[1].nextSibling).toHaveTextContent("4");
    expect(screen.getByText("2 of the requirements aren't marked: they're worded differently in the posting.")).toBeInTheDocument();
  });

  it("adds a gap's skill to the profile with the role it was used in, which covers it (E30-5)", async () => {
    vi.mocked(addGapSkill).mockResolvedValue({ ok: true, data: { name: "Accessibility", where: "Northwind", experienceId: "role-1" } });
    await review({ roles: { first: [{ id: "role-1", label: "Northwind, 2021 – now" }] }, profiles: [{ id: "first", name: "Design" }], defaultProfileId: "first" });
    const fit = within(screen.getAllByRole("complementary", { name: "How you fit" })[0]);
    await userEvent.click(fit.getByRole("button", { name: "Add to profile" }));
    await userEvent.type(fit.getByLabelText(/^What you did with it/), "Audited the checkout.");
    await userEvent.click(within(fit.getByRole("group", { name: "Add Accessibility to your profile" })).getByRole("button", { name: "Add to profile" }));
    expect(addGapSkill).toHaveBeenCalledWith({ profileId: "first", name: "Accessibility", experienceId: "role-1", did: "Audited the checkout." });
    expect(fit.getByText("3 of 4 covered")).toBeInTheDocument();
    expect(fit.getByText("At Northwind")).toBeInTheDocument();
  });

  it("keeps “I don't have this” for the application", async () => {
    vi.mocked(startWritingApplication).mockResolvedValue({ ok: true, data: "app-1" });
    await review();
    const fit = within(screen.getAllByRole("complementary", { name: "How you fit" })[0]);
    await userEvent.click(fit.getByRole("button", { name: "Add to profile" }));
    await userEvent.click(fit.getByRole("button", { name: "I don't have this" }));
    expect(fit.getByText("You don't have this")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Write resume and letter" })[0]);
    expect(startWritingApplication).toHaveBeenCalledWith(expect.objectContaining({ knownGaps: ["Accessibility know-how"] }));
  });

  it("asks how to write it: what, the letter's tone, its language and a note", async () => {
    vi.mocked(startWritingApplication).mockResolvedValue({ ok: true, data: "app-1" });
    await review({ defaultTone: "FORMAL" });
    const tones = screen.getByRole("radiogroup", { name: "Letter's tone" });
    expect(within(tones).getByRole("radio", { name: "Formal" })).toBeChecked();
    expect(screen.getByText("Traditional and polished.")).toBeInTheDocument();
    await userEvent.click(within(tones).getByRole("radio", { name: "Direct" }));
    expect(screen.getByLabelText("Language")).toHaveDisplayValue("English, like the posting");
    await userEvent.selectOptions(screen.getByLabelText("Language"), "Dutch");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Write" })).getByRole("radio", { name: "Resume" }));
    // No tone for a resume.
    expect(screen.queryByRole("radiogroup", { name: "Letter's tone" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Anything I should know?")).toHaveAccessibleDescription("Kept with this application as a fact for the AI.");
    await userEvent.click(screen.getAllByRole("button", { name: "Write the resume" })[0]);
    expect(startWritingApplication).toHaveBeenCalledWith(expect.objectContaining({ tone: "DIRECT", language: "Dutch", write: "resume" }));
  });

  it("names the language from Settings when there is one", async () => {
    await review({ docLanguage: "German" });
    expect(screen.getByLabelText("Language")).toHaveDisplayValue("German, from Settings");
  });

  it("saves the posting for later instead, into Positions (E31-3)", async () => {
    vi.mocked(savePostingForLater).mockResolvedValue({ ok: true, data: "posting-9" });
    await review();
    await userEvent.click(screen.getByRole("button", { name: "Save it for later" }));
    expect(savePostingForLater).toHaveBeenCalledWith({
      posting,
      postingUrl: "",
      details: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: "Amsterdam", mode: "", salary: "" },
      readJobId: "job-1",
      postingId: null,
    });
    expect(toast).toHaveBeenCalledWith("Saved for later, under Saved in Positions.");
    expect(router.push).toHaveBeenCalledWith("/jobs?show=saved");
  });

  it("goes back to the posting from the breadcrumb, with everything kept", async () => {
    await review();
    await userEvent.type(screen.getByLabelText("Anything I should know?"), "Lean on research.");
    await userEvent.click(screen.getByRole("link", { name: "New" }));
    expect(screen.getByLabelText("Job posting")).toHaveValue(posting);
    expect(window.location.search).toBe("?step=paste");
  });
});

describe("writing it (E31-4)", () => {
  const read = {
    extracted: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
    extractedWith: "extract-posting@1",
    match: { items: [] },
    matchedWith: "match-requirements@1",
  };

  it("makes the Draft on the server and opens it straight away, the application's own URL", async () => {
    vi.mocked(startWritingApplication).mockResolvedValue({ ok: true, data: "app-1" });
    const { unmount } = render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    emit({ status: "DONE", result: read });
    await userEvent.type(screen.getByLabelText("Anything I should know?"), "Lean on research.");
    await userEvent.click(screen.getAllByRole("button", { name: "Write resume and letter" })[0]);
    expect(startWritingApplication).toHaveBeenCalledWith({
      readJobId: "job-1",
      details: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: "", mode: "", salary: "", deadline: "" },
      match: { items: [] },
      tone: "WARM",
      note: "Lean on research.",
      write: "both",
      language: "",
      knownGaps: [],
      postingUrl: "",
      postingId: null,
      startupId: null,
    });
    expect(router.replace).toHaveBeenCalledWith("/applications/app-1");
    // The tab's draft is done with, once the page has gone; until then the review stays.
    expect(screen.getByRole("heading", { name: "What I read from the posting" })).toBeInTheDocument();
    expect(sessionStorage.length).toBe(1);
    unmount();
    expect(sessionStorage.length).toBe(0);
  });

  it("writes for the Find jobs posting or the startup it started from (E14-8, #222)", async () => {
    vi.mocked(startWritingApplication).mockResolvedValue({ ok: true, data: "app-1" });
    const { unmount } = render(<NewApplication {...props} fromPosting={{ id: "posting-1", text: "Ledgerly: Designer\n\nWe're hiring.", url: "https://jobs.example/1", complete: true }} />);
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    expect(startReadingPosting).toHaveBeenCalledWith({ posting: "Ledgerly: Designer\n\nWe're hiring.", postingId: "posting-1" });
    emit({ status: "DONE", result: read });
    await userEvent.click(screen.getAllByRole("button", { name: "Write resume and letter" })[0]);
    expect(startWritingApplication).toHaveBeenCalledWith(expect.objectContaining({ postingUrl: "https://jobs.example/1", postingId: "posting-1" }));
    unmount();

    render(<NewApplication {...props} fromPosting={{ id: null, startup: { id: "startup-1", company: "Canalworks" }, text: "Canalworks is hiring a designer.", url: "https://news.example/1", complete: true }} />);
    expect(screen.getByLabelText("Job posting")).toHaveValue("Canalworks is hiring a designer.");
    expect(toast).toHaveBeenCalledWith("Here's what Startups knows about Canalworks, without its addresses. Add the role you're after if it doesn't say, then read it.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    emit({ status: "DONE", result: read });
    await userEvent.click(screen.getAllByRole("button", { name: "Write resume and letter" })[0]);
    expect(startWritingApplication).toHaveBeenLastCalledWith(expect.objectContaining({ postingId: null, startupId: "startup-1" }));
  });

  it("stays on the review, with everything kept, when it can't start", async () => {
    vi.mocked(startWritingApplication).mockResolvedValue({ ok: false, error: "That reading of the posting is no longer available. Read the posting again." });
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    emit({ status: "DONE", result: read });
    await userEvent.type(screen.getByLabelText("Anything I should know?"), "Lean on research.");
    await userEvent.click(screen.getAllByRole("button", { name: "Write resume and letter" })[0]);
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/applications\//));
    expect(screen.getByLabelText("Anything I should know?")).toHaveValue("Lean on research.");
  });
});

describe("keeping the draft (E7-7)", () => {
  it("survives a reload in the same tab", async () => {
    const { unmount } = render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.type(screen.getByLabelText(/^Link to the posting/), "https://jobs.example/1");
    unmount();
    render(<NewApplication {...props} />);
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly is hiring.");
    expect(screen.getByLabelText(/^Link to the posting/)).toHaveValue("https://jobs.example/1");
  });

  it("starts over from “+ New application”", async () => {
    const { unmount } = render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    unmount();
    render(<NewApplication {...props} fresh />);
    expect(screen.getByLabelText("Job posting")).toHaveValue("");
    expect(router.replace).toHaveBeenCalledWith("/new");
  });

  it("starts over from a Find jobs posting, at the paste step, to check first (E14-8)", async () => {
    const { unmount } = render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Something else.");
    unmount();
    render(<NewApplication {...props} fromPosting={{ id: "posting-1", text: "Ledgerly: Designer\n\nWe're hiring.", url: "https://jobs.example/1", complete: true }} />);
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly: Designer\n\nWe're hiring.");
    expect(screen.getByLabelText(/^Link to the posting/)).toHaveValue("https://jobs.example/1");
    expect(toast).toHaveBeenCalledWith("Here's the posting from Find jobs. Check it, then read it.");
    expect(router.replace).toHaveBeenCalledWith("/new");
    expect(startReadingPosting).not.toHaveBeenCalled();
  });

  it("says when only the start of the posting came through", () => {
    render(<NewApplication {...props} fromPosting={{ id: "posting-1", text: "Ledgerly: Designer\n\nThe start…", url: "https://jobs.example/1", complete: false }} />);
    expect(toast).toHaveBeenCalledWith("Only the start of this posting came through. Paste the rest from the posting's page, then read it.");
  });

  it("goes back and on again without reading the same posting twice", async () => {
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    emit({
      status: "DONE",
      result: {
        extracted: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
        extractedWith: "extract-posting@1",
        match: { items: [] },
        matchedWith: "match-requirements@1",
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Edit what I read" }));
    await userEvent.clear(screen.getByLabelText("Company"));
    await userEvent.type(screen.getByLabelText("Company"), "Ledgerly B.V.");
    await userEvent.click(screen.getByRole("link", { name: "New" }));
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    expect(startReadingPosting).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1, name: "Designer at Ledgerly B.V." })).toBeInTheDocument();
    // A changed posting is read again.
    await userEvent.click(screen.getByRole("link", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Job posting"), " Apply now.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    expect(startReadingPosting).toHaveBeenCalledTimes(2);
  });

  it("gives each step its own URL, and a reload keeps it (E31-1, public 111)", async () => {
    const { unmount } = render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    expect(window.location.search).toBe("?step=review");
    emit({
      status: "DONE",
      result: {
        extracted: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
        extractedWith: "extract-posting@1",
        match: { items: [] },
        matchedWith: "match-requirements@1",
      },
    });
    unmount();
    // A reload, at the review.
    const again = render(<NewApplication {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Designer at Ledgerly" })).toBeInTheDocument();
    again.unmount();
    // Back: the paste step's URL shows the posting, with the review kept for Forward.
    window.history.replaceState(null, "", "/new?step=paste");
    const back = render(<NewApplication {...props} />);
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly is hiring.");
    back.unmount();
    window.history.replaceState(null, "", "/new?step=review");
    render(<NewApplication {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Designer at Ledgerly" })).toBeInTheDocument();
  });

  it("shows the paste step for a review URL with nothing read, and fixes the URL", () => {
    window.history.replaceState(null, "", "/new?step=review");
    render(<NewApplication {...props} />);
    expect(screen.getByLabelText("Job posting")).toHaveValue("");
    expect(window.location.search).toBe("?step=paste");
  });

  it("asks before leaving while the AI works, and stops it when you do", async () => {
    const confirm = vi.spyOn(window, "confirm");
    render(
      <>
        <a href="/profile">Profile</a>
        <NewApplication {...props} />
      </>,
    );
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting" }));
    emit({ step: "Reading the posting" });

    confirm.mockReturnValueOnce(false);
    const stay = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Profile" }).dispatchEvent(stay);
    expect(confirm).toHaveBeenCalledWith("Leave now? I'll stop reading the posting.");
    expect(stay.defaultPrevented).toBe(true);
    expect(cancel).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    const leave = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Profile" }).dispatchEvent(leave);
    expect(cancel).toHaveBeenCalledWith({ id: "job-1" });
    confirm.mockRestore();
  });
});

