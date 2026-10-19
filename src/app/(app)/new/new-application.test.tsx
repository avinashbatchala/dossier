import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { JobView } from "@/lib/jobs/runner";

import { addSkill } from "../profile/actions";

import { cancel } from "@/lib/jobs/actions";

import { createApplication, fetchPostingText, startReadingPosting, startWritingDocuments } from "./actions";
import { NewApplication } from "./new-application";

vi.mock("./actions", () => ({ startReadingPosting: vi.fn(), startWritingDocuments: vi.fn(), createApplication: vi.fn(), fetchPostingText: vi.fn() }));
vi.mock("../profile/actions", () => ({ addSkill: vi.fn(async ({ name }: { name: string }) => ({ ok: true, data: { skill: { id: "s9", name }, added: true } })) }));
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
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));

const props = { aiReady: true, samplePosting: "Ledgerly is hiring a Senior Product Designer.", defaultTone: "WARM" as const };

function emit(job: Partial<JobView>) {
  const view = { id: "job-1", type: "read-posting", status: "RUNNING", step: null, error: null, result: null, ...job };
  act(() => jobs.listeners.get(view.id)?.(view));
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(toast).mockReset();
  vi.mocked(startReadingPosting).mockReset().mockResolvedValue({ ok: true, data: "job-1" });
  router.push.mockReset();
  vi.mocked(createApplication).mockReset();
});

describe("the paste step (E7-1)", () => {
  it("has the header, the stepper and the posting fields", () => {
    render(<NewApplication {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "New application" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "New application steps" })).toHaveTextContent("Paste the posting2Check the details3Tailored documents");
    expect(screen.getByLabelText("Job posting")).toHaveAttribute("rows", "14");
    expect(screen.getByLabelText(/^Link to the posting/)).toHaveAttribute("placeholder", "https://");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("stays focusable but explains itself while there's no posting", async () => {
    render(<NewApplication {...props} />);
    const read = screen.getByRole("button", { name: "Read the posting →" });
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
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    expect(toast).toHaveBeenCalledWith("Paste a job posting first.");
  });

  it("fetches the posting from its link, with a way back to what was there (E7-8)", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPostingText).mockResolvedValueOnce({ ok: true, data: { text: "Ledgerly: Senior Designer\n\nWhat you'll do…", url: "https://www.jobs.ledgerly.example/123" } });
    render(<NewApplication {...props} />);
    expect(screen.getByText(/^Fetch asks the job site for the page from your server/)).toBeInTheDocument();
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

  it("explains why a link can't be fetched, and asks for one first", async () => {
    const user = userEvent.setup();
    render(<NewApplication {...props} />);
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(toast).toHaveBeenCalledWith("Enter the link to the posting first.");
    expect(fetchPostingText).not.toHaveBeenCalled();
  });

  it("points to Settings when no AI provider is set up", () => {
    render(<NewApplication {...props} aiReady={false} />);
    expect(screen.getByRole("link", { name: "Choose one in Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
  });
});

describe("the reading step (E7-2)", () => {
  async function startReading() {
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
  }

  it("shows the job's own steps as they happen", async () => {
    await startReading();
    expect(startReadingPosting).toHaveBeenCalledWith({ posting: "Ledgerly is hiring." });
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

  it("moves on to Check the details when the job is done", async () => {
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
    expect(screen.getByText("Check the details").closest("li")).toHaveAttribute("aria-current", "step");
  });
});

describe("the details (E7-3)", () => {
  it("shows what was read, editable, and leaves what the posting doesn't say empty", async () => {
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    emit({
      status: "DONE",
      result: {
        extracted: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: "Amsterdam", mode: null, salary: null, deadline: "2026-10-15", requirements: [], asksForReferences: false, language: "English" },
        extractedWith: "extract-posting@1",
        match: { items: [] },
        matchedWith: "match-requirements@1",
      },
    });
    expect(screen.getByRole("heading", { name: "The application" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Designer · Ledgerly");
    expect(screen.getByText("Suggested by AI. Change it if you like")).toBeInTheDocument();
    expect(screen.getByLabelText("Company")).toHaveValue("Ledgerly");
    expect(screen.getByLabelText("Salary")).toHaveValue("");
    expect(screen.getByLabelText("Salary")).toHaveAttribute("placeholder", "Not mentioned");
    expect(screen.getByLabelText("Apply by")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Apply by")).toHaveValue("2026-10-15");
    await userEvent.clear(screen.getByLabelText("Company"));
    await userEvent.type(screen.getByLabelText("Company"), "Ledgerly B.V.");
    expect(screen.getByLabelText("Company")).toHaveValue("Ledgerly B.V.");
  });
});

describe("how you match (E7-4)", () => {
  const read = {
    extracted: {
      title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null,
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
        { requirement: "Accessibility know-how", result: "gap", skill: null, experienceIds: [], note: "Not in your profile yet" },
        { requirement: "Strong prototyping in Figma", result: "partial", skill: "Figma", experienceIds: [], note: "In your skills, but not linked to a role yet" },
        { requirement: "Experience with payments", result: "gap", skill: null, experienceIds: [], note: "Nothing in your profile, so I'll address it honestly in the letter" },
      ],
    },
    matchedWith: "match-requirements@1",
  };

  async function review() {
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    emit({ status: "DONE", result: read });
  }

  it("shows each requirement honestly, not by colour or symbol alone (NEW-4)", async () => {
    await review();
    expect(screen.getByRole("heading", { name: "How you match" })).toBeInTheDocument();
    expect(screen.getByText("2 of 4 covered by your profile")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Requirements" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "✓Covered: 5+ years of product design3 roles in your profile, since Sep 2015",
      "–Not covered: Accessibility know-howNot in your profile yet+ Add to profile",
      "~Partly covered: Strong prototyping in FigmaIn your skills, but not linked to a role yet",
      "–Not covered: Experience with paymentsNothing in your profile, so I'll address it honestly in the letter",
    ]);
    expect(screen.getByText(/^Gaps aren't dealbreakers\./)).toBeInTheDocument();
  });

  it("adds a missing skill to the profile, which makes it partly covered (NEW-5)", async () => {
    await review();
    await userEvent.click(screen.getByRole("button", { name: "+ Add to profile" }));
    expect(addSkill).toHaveBeenCalledWith({ name: "Accessibility" });
    expect(toast).toHaveBeenCalledWith("Added “Accessibility” to your skills. Attach it to a role under Experience to make it count.");
    expect(screen.getByText("3 of 4 covered by your profile")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add to profile" })).not.toBeInTheDocument();
  });
});

describe("tailoring (E7-5)", () => {
  async function review(tone: "WARM" | "FORMAL" = "WARM") {
    render(<NewApplication {...props} defaultTone={tone} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    emit({
      status: "DONE",
      result: {
        extracted: { title: null, company: "Ledgerly", role: null, location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
        extractedWith: "extract-posting@1",
        match: { items: [] },
        matchedWith: "match-requirements@1",
      },
    });
  }

  it("starts from the default tone and describes each one (NEW-6)", async () => {
    await review("FORMAL");
    const tones = screen.getByRole("radiogroup", { name: "Cover letter tone" });
    expect(within(tones).getByRole("radio", { name: "Formal" })).toBeChecked();
    expect(screen.getByText("Traditional and polished.")).toBeInTheDocument();
    await userEvent.click(within(tones).getByRole("radio", { name: "Direct" }));
    expect(screen.getByText("Short sentences, straight to the point.")).toBeInTheDocument();
    expect(screen.getByLabelText("Anything I should know?")).toHaveAttribute("placeholder", "e.g. I'm relocating to Amsterdam in January. Or: lean on my research work.");
  });

  it("goes back to the posting with everything kept", async () => {
    await review();
    await userEvent.type(screen.getByLabelText("Anything I should know?"), "Lean on research.");
    await userEvent.click(screen.getByRole("button", { name: "← Back to the posting" }));
    expect(screen.getByLabelText("Job posting")).toHaveValue("Ledgerly is hiring.");
  });
});

describe("creating the application (E7-6)", () => {
  const read = {
    extracted: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
    extractedWith: "extract-posting@1",
    match: { items: [] },
    matchedWith: "match-requirements@1",
  };

  async function create() {
    vi.mocked(startWritingDocuments).mockResolvedValue({ ok: true, data: "job-2" });
    render(<NewApplication {...props} />);
    await userEvent.type(screen.getByLabelText("Job posting"), "Ledgerly is hiring.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    emit({ status: "DONE", result: read });
    await userEvent.type(screen.getByLabelText("Anything I should know?"), "Lean on research.");
    await userEvent.click(screen.getByRole("button", { name: "Create application →" }));
  }

  it("writes the documents, then saves the application and opens it (NEW-7)", async () => {
    vi.mocked(createApplication).mockResolvedValue({ ok: true, data: "app-1" });
    await create();
    expect(startWritingDocuments).toHaveBeenCalledWith({
      readJobId: "job-1",
      details: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: "", mode: "", salary: "", deadline: "" },
      match: { items: [] },
      tone: "WARM",
      note: "Lean on research.",
    });
    expect(screen.getByRole("heading", { name: "Putting your application together…" })).toBeInTheDocument();
    expect(screen.getByText("Tailored documents").closest("li")).toHaveAttribute("aria-current", "step");
    emit({ id: "job-2", type: "write-documents", step: "Writing your cover letter" });
    expect(screen.getByText("Writing your cover letter").closest("li")).toHaveAttribute("aria-current", "step");
    emit({ id: "job-2", type: "write-documents", status: "DONE", step: "Writing your cover letter" });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/applications/app-1"));
    expect(createApplication).toHaveBeenCalledWith(expect.objectContaining({ writeJobId: "job-2", postingUrl: "" }));
    expect(toast).toHaveBeenCalledWith("Your application is ready. Nothing gets sent until you say so.");
  });

  it("offers Retry, keeping everything, when saving fails", async () => {
    vi.mocked(createApplication).mockResolvedValueOnce({ ok: false, error: "Something went wrong on the server. Please try again." }).mockResolvedValueOnce({ ok: true, data: "app-1" });
    await create();
    emit({ id: "job-2", type: "write-documents", status: "DONE", step: "Writing your cover letter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on the server.");
    expect(screen.getByText("Saving the application").closest("li")).toHaveAttribute("aria-current", "step");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/applications/app-1"));
  });

  it("links the application to the Find jobs posting it started from (E14-8)", async () => {
    vi.mocked(startWritingDocuments).mockResolvedValue({ ok: true, data: "job-2" });
    vi.mocked(createApplication).mockResolvedValue({ ok: true, data: "app-1" });
    render(<NewApplication {...props} fromPosting={{ id: "posting-1", text: "Ledgerly: Designer\n\nWe're hiring.", url: "https://jobs.example/1", complete: true }} />);
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    expect(startReadingPosting).toHaveBeenCalledWith({ posting: "Ledgerly: Designer\n\nWe're hiring." });
    emit({ status: "DONE", result: read });
    await userEvent.click(screen.getByRole("button", { name: "Create application →" }));
    emit({ id: "job-2", type: "write-documents", status: "DONE", step: "Writing your cover letter" });
    await vi.waitFor(() => expect(createApplication).toHaveBeenCalledWith(expect.objectContaining({ postingUrl: "https://jobs.example/1", postingId: "posting-1" })));
  });

  it("goes back to the details when writing fails", async () => {
    await create();
    emit({ id: "job-2", type: "write-documents", status: "FAILED", step: "Tailoring your resume", error: "The model took too long to answer. Try again, or pick a faster model." });
    expect(screen.getByRole("alert")).toHaveTextContent("The model took too long to answer.");
    await userEvent.click(screen.getByRole("button", { name: "← Back to the details" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    emit({
      status: "DONE",
      result: {
        extracted: { title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" },
        extractedWith: "extract-posting@1",
        match: { items: [] },
        matchedWith: "match-requirements@1",
      },
    });
    await userEvent.clear(screen.getByLabelText("Company"));
    await userEvent.type(screen.getByLabelText("Company"), "Ledgerly B.V.");
    await userEvent.click(screen.getByRole("button", { name: "← Back to the posting" }));
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    expect(startReadingPosting).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Company")).toHaveValue("Ledgerly B.V.");
    // A changed posting is read again.
    await userEvent.click(screen.getByRole("button", { name: "← Back to the posting" }));
    await userEvent.type(screen.getByLabelText("Job posting"), " Apply now.");
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    expect(startReadingPosting).toHaveBeenCalledTimes(2);
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
    await userEvent.click(screen.getByRole("button", { name: "Read the posting →" }));
    emit({ step: "Reading the posting" });

    confirm.mockReturnValueOnce(false);
    const stay = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Profile" }).dispatchEvent(stay);
    expect(confirm).toHaveBeenCalledWith("Leave now? I'll stop working on this application, and nothing will be created.");
    expect(stay.defaultPrevented).toBe(true);
    expect(cancel).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    const leave = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "Profile" }).dispatchEvent(leave);
    expect(cancel).toHaveBeenCalledWith({ id: "job-1" });
    confirm.mockRestore();
  });
});

