import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { copyText } from "@/lib/copy-text";
import { demoLetterUnits, demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { DEFAULT_SECTION_LAYOUT } from "@/lib/resume-sections";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { retry } from "@/lib/jobs/actions";
import type { JobView } from "@/lib/jobs/runner";

import {
  addMatchSkill,
  markKnownGap,
  addNote,
  deleteNote,
  leaveOutUnit,
  putBackTrimmed,
  restoreNote,
  restoreUnit,
  saveUnit,
  sendMessage,
  rewriteLetter,
  setApplicationTheme,
  setFollowThemeLayout,
  setShowPhoto,
  startRegenerating,
  startCheckingRequirements,
  startWritingDocument,
  startWritingEmail,
  undoEmailRewrite,
  goBackTo,
  stopWritingApplication,
  startPreparing,
  tickPrep,
  startWritingMessage,
  markMessageSent,
  undoMessage,
  updateNote,
} from "./actions";
import { ApplicationView, letterPlaces, type ApplicationViewProps } from "./application-view";

vi.mock("./actions", () => ({
  setApplicationTheme: vi.fn(async () => ({ ok: true, data: null })),
  setFollowThemeLayout: vi.fn(async () => ({ ok: true, data: null })),
  setShowPhoto: vi.fn(async () => ({ ok: true, data: null })),
  saveUnit: vi.fn(async ({ text }: { text: string }) => ({ ok: true, data: { text } })),
  startRegenerating: vi.fn(async () => ({ ok: true, data: "job-1" })),
  restoreUnit: vi.fn(async () => ({ ok: true, data: null })),
  sendMessage: vi.fn(async () => ({ ok: true, data: { jobId: "reply-1" } })),
  rewriteLetter: vi.fn(async () => ({ ok: true, data: "letter-1" })),
  goBackTo: vi.fn(async (): Promise<unknown> => ({ ok: true, data: ["RESUME"] })),
  startPreparing: vi.fn(async () => ({ ok: true, data: "prep-1" })),
  tickPrep: vi.fn(async () => ({ ok: true, data: null })),
  updateInterview: vi.fn(async () => ({ ok: true, data: null })),
  addInterviewRound: vi.fn(async () => ({ ok: true, data: { id: "i3", round: 3 } })),
  saveOffer: vi.fn(async () => ({ ok: true, data: null })),
  startWritingMessage: vi.fn(async () => ({ ok: true, data: "msg-1" })),
  saveMessageDraft: vi.fn(async () => ({ ok: true, data: null })),
  markMessageSent: vi.fn(async () => ({ ok: true, data: null })),
  discardMessageDraft: vi.fn(async () => ({ ok: true, data: null })),
  undoMessage: vi.fn(async () => ({ ok: true, data: { edited: [{ document: "RESUME", unitId: "summary" }] } })),
  addMatchSkill: vi.fn(async (): Promise<unknown> => ({ ok: true, data: { name: "Kubernetes", where: "", experienceId: null } })),
  markKnownGap: vi.fn(async () => ({ ok: true, data: null })),
  forgetKnownGap: vi.fn(async () => ({ ok: true, data: null })),
  addNote: vi.fn(async () => ({ ok: true, data: null })),
  updateNote: vi.fn(async () => ({ ok: true, data: null })),
  deleteNote: vi.fn(async () => ({ ok: true, data: { body: "Called John.", createdAt: "2026-10-03T13:00:00.000Z", updatedAt: "2026-10-03T13:00:00.000Z" } })),
  restoreNote: vi.fn(async () => ({ ok: true, data: null })),
  putBackTrimmed: vi.fn(async () => ({ ok: true, data: null })),
  leaveOutUnit: vi.fn(async () => ({ ok: true, data: { index: 2 } })),
  startWritingEmail: vi.fn(async () => ({ ok: true, data: "email-1" })),
  startWritingDocument: vi.fn(async () => ({ ok: true, data: "document-1" })),
  startCheckingRequirements: vi.fn(async () => ({ ok: true, data: "check-1" })),
  undoEmailRewrite: vi.fn(async () => ({ ok: true, data: null })),
  stopWritingApplication: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("@/lib/jobs/actions", () => ({ retry: vi.fn(async () => ({ ok: true, data: null })) }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
// Jobs report whatever the test says, as the real hook would.
const jobs = vi.hoisted(() => ({ listeners: new Map<string, (job: unknown) => void>(), revisions: new Map<string, number>() }));
vi.mock("@/hooks/use-job", async () => {
  const { useEffect } = await import("react");
  return {
    useJob: (id: string | null, revision: number, onChange?: (job: unknown) => void) => {
      useEffect(() => {
        if (!id) return;
        jobs.listeners.set(id, (job) => onChange?.(job));
        jobs.revisions.set(id, revision);
        return () => void jobs.listeners.delete(id);
      });
      return null;
    },
  };
});

function report(job: Partial<JobView>) {
  const view = { id: "job-1", type: "regenerate-unit", status: "RUNNING", step: null, error: null, result: null, ...job };
  act(() => jobs.listeners.get(view.id)?.(view));
}
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const theme = (id: string) => BUILT_IN_THEMES.find((entry) => entry.id === id)!;

const props: ApplicationViewProps = {
  application: {
    id: "app-1",
    title: "Senior Product Designer · Ledgerly",
    role: "Senior Product Designer",
    company: "Ledgerly",
    location: "Amsterdam",
    status: "DRAFT",
    tone: "WARM",
    language: "English",
    followThemeLayout: false,
    showPhoto: null,
    archived: false,
    nextInterviewAt: null,
  },
  posting: { text: "Ledgerly is hiring.\n\n  - Figma", url: "", pasted: "27 Sep" },
  match: null,
  requirements: [],
  facts: [{ id: "f1", text: "I know their product as a customer." }],
  activity: [{ kind: "created", id: "created", date: "27 Sep" }],
  meta: ["Amsterdam"],
  resume: { units: demoResumeUnits(), theme: theme("editorial") },
  letter: { units: demoLetterUnits(), theme: theme("editorial") },
  themes: [...BUILT_IN_THEMES, { ...theme("modern"), id: "mine", name: "Mine", builtIn: false }],
  sections: DEFAULT_SECTION_LAYOUT,
  ownSections: false,
  sent: false,
  canUpdate: false,
  baseSections: [],
  baseThemeId: "modern",
  email: null,
  writingEmail: null,
  attachments: { resume: "Jane Doe – Ledgerly – Resume.pdf", letter: "Jane Doe – Ledgerly – Cover letter.pdf" },
  profile: demoProfile(),
  paper: "A4",
  dateFormat: "DAY_MONTH_YEAR",
  includeReferences: false,
  letterDate: new Date(Date.UTC(2026, 8, 28)),
  initialTab: "resume",
  aiReady: true,
  rewriting: [],
  messages: [],
  refining: null,
  suggestions: { resume: ["Make the summary shorter"], letter: ["Make it more formal"], email: ["Shorter, under 100 words"] },
};

beforeEach(() => {
  window.history.replaceState(null, "", "/applications/app-1");
  vi.mocked(setFollowThemeLayout).mockClear();
  vi.mocked(setApplicationTheme).mockClear();
  vi.mocked(saveUnit).mockClear();
  vi.mocked(startRegenerating).mockClear();
  vi.mocked(restoreUnit).mockClear();
  vi.mocked(sendMessage).mockClear();
  vi.mocked(goBackTo).mockClear();
  vi.mocked(startWritingEmail).mockClear();
  vi.mocked(undoEmailRewrite).mockClear();
  vi.mocked(toast).mockClear();
  router.refresh.mockClear();
  router.push.mockClear();
});

const summary = demoResumeUnits()[0];

describe("the document tabs (E8-2)", () => {
  it("has Resume, Cover letter, Email, the posting and Notes, with a dot on what's ready (E30-2)", () => {
    const { rerender } = render(<ApplicationView {...props} />);
    const tabs = () => within(screen.getByRole("tablist", { name: "Application" })).getAllByRole("tab");
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Resume", "Cover letter", "Email", "Job posting", "Notes"]);
    expect(screen.getByRole("tab", { name: "Resume" })).toHaveAttribute("aria-selected", "true");
    rerender(<ApplicationView {...props} email={[{ id: "body", label: "Body", text: "Hello" }]} />);
    expect(screen.getByRole("tab", { name: "Email, ready" })).toBeInTheDocument();
  });

  it("offers the one next step for its status, which opens its tab (E30-2)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("button", { name: "Review and send" }));
    expect(screen.getByRole("tab", { name: /^Email/ })).toHaveAttribute("aria-selected", "true");
    rerender(<ApplicationView {...props} application={{ ...props.application, status: "OFFER" }} />);
    expect(screen.getByRole("button", { name: "Review offer" })).toBeInTheDocument();
    rerender(<ApplicationView {...props} application={{ ...props.application, status: "SENT" }} />);
    expect(screen.queryByRole("button", { name: /Review|Answer|Prepare/ })).not.toBeInTheDocument();
  });

  it("keeps the tab in the URL", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("tab", { name: "Cover letter" }));
    expect(window.location.search).toBe("?tab=letter");
    await user.click(screen.getByRole("tab", { name: "Resume" }));
    expect(window.location.search).toBe("");
  });

  it("opens on the tab from the URL", () => {
    render(<ApplicationView {...props} initialTab="posting" />);
    expect(screen.getByRole("tab", { name: /Job posting/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Ledgerly is hiring\./)).toHaveTextContent("Ledgerly is hiring. - Figma");
    // The application's facts for the AI come first (APP-15).
    const facts = screen.getByRole("region", { name: "Facts for this application" });
    expect(within(facts).getByLabelText("Fact 1")).toHaveValue("I know their product as a customer.");
    expect(within(facts).getByRole("link", { name: "Facts about me" })).toHaveAttribute("href", "/profile?section=facts");
  });

  it("shows the tailored resume in its theme, in a single column by default", () => {
    render(<ApplicationView {...props} />);
    expect(screen.getByText("Tailored resume")).toBeInTheDocument();
    const resume = screen.getByRole("article", { name: "Resume" });
    expect(resume.querySelector('[data-unit="summary"]')).toHaveTextContent(demoResumeUnits()[0].text);
  });

  it("has nothing to switch in a single-column theme without a photo (E30-9)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("button", { name: "Editorial theme" }));
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
  });

  it("lets a sidebar theme use its own layout, saved on the application", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} resume={{ units: demoResumeUnits(), theme: theme("modern") }} />);
    const resume = screen.getByRole("article", { name: "Resume" });
    expect(within(resume).queryByText("Contact")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Modern theme" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Sidebar layout" }));
    expect(setFollowThemeLayout).toHaveBeenCalledWith({ id: "app-1", follow: true });
  });

  it("has a Photo switch while the profile has a photo, starting from its Show on resumes (#224)", async () => {
    const user = userEvent.setup();
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const profile = { ...props.profile, photo: { src: png, onResumes: true } };
    render(<ApplicationView {...props} profile={profile} />);
    const resume = screen.getByRole("article", { name: "Resume" });
    expect(within(resume).getByRole("img", { name: profile.basics.name })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editorial theme" }));
    const toggle = screen.getByRole("menuitemcheckbox", { name: "Photo" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(setShowPhoto).toHaveBeenCalledWith({ id: "app-1", show: false });
  });

  it("shows the photo as the application says (#224)", async () => {
    const user = userEvent.setup();
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const profile = { ...props.profile, photo: { src: png, onResumes: false } };
    render(<ApplicationView {...props} profile={profile} application={{ ...props.application, showPhoto: true }} />);
    expect(within(screen.getByRole("article", { name: "Resume" })).getByRole("img")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editorial theme" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Photo" })).toHaveAttribute("aria-checked", "true");
  });

  it("changes the resume's and cover letter's theme together from the Theme menu (#226)", async () => {
    const user = userEvent.setup();
    let answer: (result: { ok: true; data: null }) => void = () => {};
    vi.mocked(setApplicationTheme).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    render(<ApplicationView {...props} />);

    await user.click(screen.getByRole("button", { name: "Editorial theme" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: "Editorial" })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitemradio", { name: "Modern base theme" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent).slice(-2)).toEqual(["Atlas", "Mine"]);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();

    // Shown in the new theme while it's saved: Modern has a sidebar, so its layout switch appears.
    await user.click(within(menu).getByRole("menuitemradio", { name: "Modern base theme" }));
    expect(setApplicationTheme).toHaveBeenCalledWith({ id: "app-1", themeId: "modern" });
    await user.click(screen.getByRole("button", { name: "Modern theme" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Sidebar layout" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await act(async () => answer({ ok: true, data: null }));
  });

  it("doesn't save the theme the documents already have", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("button", { name: "Editorial theme" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Editorial" }));
    expect(setApplicationTheme).not.toHaveBeenCalled();
  });

  it("follows the theme's layout when the application says so", () => {
    render(
      <ApplicationView
        {...props}
        application={{ ...props.application, followThemeLayout: true }}
        resume={{ units: demoResumeUnits(), theme: theme("modern") }}
      />,
    );
    expect(within(screen.getByRole("article", { name: "Resume" })).getByText("Contact")).toBeInTheDocument();
  });

  it("lays out the cover letter with its word count", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("tab", { name: "Cover letter" }));
    const letter = screen.getByRole("article", { name: "Cover letter" });
    expect(within(letter).getByText("28 September 2026")).toBeInTheDocument();
    expect(within(letter).getByText("Ledgerly · Hiring team")).toBeInTheDocument();
    expect(within(letter).getByText("Dear Ledgerly team,")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy text" })).toHaveAttribute("title", expect.stringMatching(/^about \d+0 words$/));
  });

  it("writes the letter again in another tone or language, from its toolbar (E30-9, AP3)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="letter" />);
    await user.click(screen.getByRole("button", { name: "Warm tone" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Formal/ }));
    expect(rewriteLetter).toHaveBeenCalledWith({ id: "app-1", tone: "FORMAL" });
    expect(await screen.findByRole("status")).toHaveTextContent("Writing the letter again, in English and a formal tone…");
    // One at a time.
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-disabled", "true");
  });

  it("copies the cover letter as text, from the greeting to the name (public issue 101)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("tab", { name: "Cover letter" }));
    await user.click(screen.getByRole("button", { name: "Copy text" }));
    const text = vi.mocked(copyText).mock.lastCall?.[0] ?? "";
    expect(text.startsWith(`Dear Ledgerly team,\n\n${demoLetterUnits()[0].text.trim()}\n\n`)).toBe(true);
    expect(text.endsWith("\n\nWarm regards,\nJane Doe")).toBe(true);
    expect(text).not.toContain("28 September 2026");
    expect(toast).toHaveBeenLastCalledWith("Copied the letter, from the greeting to your name.");
  });

  it("shows the coverage, never a score out of 100, and checks again on request (E30-1)", async () => {
    const user = userEvent.setup();
    const item = { skill: null, experienceIds: [], note: null };
    const match = {
      items: [
        { ...item, requirement: "Design systems", result: "covered" as const },
        { ...item, requirement: "Figma", result: "covered" as const },
        { ...item, requirement: "Payments", result: "gap" as const },
      ],
    };
    render(<ApplicationView {...props} match={match} />);
    expect(screen.queryByRole("button", { name: /^Score/ })).not.toBeInTheDocument();
    const column = screen.getByRole("complementary", { name: "How you fit" });
    expect(within(column).getByRole("img", { name: "2 of 3 requirements covered" })).toBeInTheDocument();
    expect(within(column).getByText("Good fit")).toBeInTheDocument();
    await user.click(within(column).getByRole("button", { name: "Check again" }));
    expect(startCheckingRequirements).toHaveBeenCalledWith({ id: props.application.id });
    expect(within(column).getByRole("button", { name: "Checking…" })).toBeDisabled();
  });

  it("says so when a document is missing, and writes it on request (#367)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} resume={null} />);
    expect(screen.getByText("This application was created without a tailored resume.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Job posting" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write the tailored resume" }));
    expect(startWritingDocument).toHaveBeenCalledWith({ id: props.application.id, kind: "RESUME" });
  });
});

describe("editing a unit (E8-3)", () => {
  it("gives every unit a focusable frame with its toolbar", () => {
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    expect(frame).toHaveAttribute("tabindex", "0");
    expect(frame).toHaveAttribute("data-unit", "summary");
    expect(within(frame).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    // Printed parts that aren't units, like the header, have none.
    expect(screen.getAllByRole("group")).toHaveLength(demoResumeUnits().length);
  });

  it("leaves a part of the resume out, with Undo on the toast (#217)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    expect(within(frame).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit", "Regenerate", "Ask AI", "Leave out"]);
    await user.click(within(frame).getByRole("button", { name: "Leave out" }));
    expect(leaveOutUnit).toHaveBeenCalledWith({ id: "app-1", unitId: "summary" });
    expect(toast).toHaveBeenLastCalledWith("Left out: Summary.", { action: expect.objectContaining({ label: "Undo" }) });
    await act(async () => vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick());
    expect(putBackTrimmed).toHaveBeenCalledWith({ id: "app-1", index: 2 });
    expect(toast).toHaveBeenLastCalledWith("Put back.");
  });

  it("keeps a publication as written: Edit and Leave out, no Regenerate or Ask AI (#218)", () => {
    render(<ApplicationView {...props} />);
    const publication = screen.getByRole("group", { name: /^Publication “Doe, J\./ });
    expect(within(publication).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit", "Leave out"]);
    expect(within(publication).getByText("Doe, J.").tagName).toBe("STRONG");
  });

  it("keeps a certification as written: Edit and Leave out, no Regenerate or Ask AI (#293)", () => {
    render(<ApplicationView {...props} />);
    const certification = screen.getByRole("group", { name: /^Certification “Certified Accessibility Specialist”/ });
    expect(within(certification).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit", "Leave out"]);
  });

  it("leaves nothing out of the cover letter", () => {
    render(<ApplicationView {...props} initialTab="letter" />);
    expect(screen.queryByRole("button", { name: "Leave out" })).not.toBeInTheDocument();
  });

  it("swaps in a text box and saves what was written", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Edit" }));

    const box = screen.getByRole("textbox", { name: "Edit Summary" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue(summary.text);
    await user.clear(box);
    await user.type(box, "Calm tools for complex work.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveUnit).toHaveBeenCalledWith({
      id: "app-1",
      document: "RESUME",
      unitId: "summary",
      text: "Calm tools for complex work.",
      expected: summary.text,
    });
    expect(screen.queryByRole("textbox", { name: /^Edit / })).not.toBeInTheDocument();
    // The action refreshes the page with the saved text.
    const units = demoResumeUnits().map((unit) => (unit.id === "summary" ? { ...unit, text: "Calm tools for complex work." } : unit));
    rerender(<ApplicationView {...props} resume={{ units, theme: theme("editorial") }} />);
    expect(screen.getByRole("group", { name: "Summary" })).toHaveTextContent("Calm tools for complex work.");
  });

  it("keeps a role's title line while its bullets are edited", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const role = screen.getByRole("group", { name: "Studio Brik role" });
    await user.click(within(role).getByRole("button", { name: "Edit" }));
    expect(role).toHaveTextContent(/^UX Designer, Studio Brik/);
    expect(within(role).getByRole("textbox")).toHaveAccessibleDescription("One bullet per line");
  });

  it("cancels with Escape and keeps the text", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Edit Summary" }), " More.");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Summary" })).toHaveTextContent(summary.text);
    expect(saveUnit).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the text when saving fails", async () => {
    const user = userEvent.setup();
    vi.mocked(saveUnit).mockResolvedValueOnce({ ok: false, error: "This part changed while you were editing it." });
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Edit Summary" }), " More.");
    await user.keyboard("{Control>}{Enter}{/Control}");

    // The save runs in a transition: wait for it to come back.
    await waitFor(() => expect(toast).toHaveBeenCalledWith("This part changed while you were editing it."));
    expect(screen.getByRole("textbox", { name: "Edit Summary" })).toHaveValue(`${summary.text} More.`);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });

  it("glows for a moment after a save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ApplicationView {...props} />);
      const frame = screen.getByRole("group", { name: "Summary" });
      await user.click(within(frame).getByRole("button", { name: "Edit" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(frame.className).toMatch(/flash/);
      act(() => vi.advanceTimersByTime(1700));
      expect(frame.className).not.toMatch(/flash/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks details the fact guard couldn't back", async () => {
    const user = userEvent.setup();
    const units = demoResumeUnits().map((unit) => (unit.id === "summary" ? { ...unit, unverified: ["40%", "2019"] } : unit));
    render(<ApplicationView {...props} resume={{ units, theme: theme("editorial") }} />);
    const marker = screen.getByRole("button", { name: "Check this: “40%”, “2019”" });
    await user.click(marker);
    expect(screen.getByText(/I couldn't find “40%”, “2019” in your profile or the posting/)).toBeInTheDocument();
  });
});

describe("regenerating a unit (E8-4)", () => {
  const rewritten = { text: "A new summary.", unverified: undefined };
  const toastAction = () => vi.mocked(toast).mock.lastCall?.[1]?.action;

  it("dims the unit while it's rewritten and leaves the rest usable", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Regenerate" }));

    expect(startRegenerating).toHaveBeenCalledWith({ id: "app-1", document: "RESUME", unitId: "summary" });
    expect(frame).toHaveAttribute("aria-busy", "true");
    expect(within(frame).getByText("Rewriting…")).toBeInTheDocument();
    expect(within(frame).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Skills" })).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows the new text with Undo on the toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Regenerate" }));
    report({ status: "DONE", result: { outcome: "rewritten", previous: summary, unit: { ...summary, ...rewritten } } });

    expect(frame).not.toHaveAttribute("aria-busy");
    expect(router.refresh).toHaveBeenCalled();
    expect(frame.className).toMatch(/flash/);
    expect(toast).toHaveBeenLastCalledWith("Rewrote the summary.", { action: expect.objectContaining({ label: "Undo" }) });

    await act(async () => toastAction()?.onClick());
    expect(restoreUnit).toHaveBeenCalledWith({
      id: "app-1",
      document: "RESUME",
      unitId: "summary",
      text: summary.text,
      unverified: undefined,
      expected: "A new summary.",
    });
    expect(toast).toHaveBeenLastCalledWith("Put the summary back.");
  });

  it("keeps an edit made meanwhile", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Regenerate" }));
    report({ status: "DONE", result: { outcome: "changed" } });
    expect(toast).toHaveBeenLastCalledWith("The summary changed while I was rewriting it, so I left your version.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("restores the unit on failure and offers Retry", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Regenerate" }));
    report({ status: "FAILED", error: "The AI server didn't answer in time." });

    expect(frame).not.toHaveAttribute("aria-busy");
    expect(frame).toHaveTextContent(summary.text);
    expect(toast).toHaveBeenLastCalledWith("The AI server didn't answer in time.", { action: expect.objectContaining({ label: "Retry" }) });

    await act(async () => toastAction()?.onClick());
    expect(retry).toHaveBeenCalledWith({ id: "job-1" });
    expect(frame).toHaveAttribute("aria-busy", "true");
    expect(jobs.revisions.get("job-1")).toBe(1);
  });

  it("picks up a rewrite that was running before a reload", () => {
    render(<ApplicationView {...props} rewriting={[{ jobId: "job-7", document: "COVER_LETTER", unitId: "paragraph:2" }]} initialTab="letter" />);
    expect(screen.getByText("Rewriting…").closest("[data-unit]")).toHaveAttribute("data-unit", "paragraph:2");
  });

  it("points to Settings without an AI provider", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} aiReady={false} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Regenerate" }));
    expect(startRegenerating).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith("That needs an AI provider. Choose one in Settings → AI provider.", {
      action: expect.objectContaining({ label: "Open Settings" }),
    });
    toastAction()?.onClick();
    expect(router.push).toHaveBeenCalledWith("/settings?section=ai");
  });
});

describe("the composer (E8-5, E30-10)", () => {
  const opening = {
    id: "m1",
    role: "AI" as const,
    text: "Here's what I tailored for Ledgerly:\n\n- Rewrote your summary\n- Wrote a warm cover letter\n\nNothing invented: every line comes from your profile.",
    targetUnit: null,
    opening: true,
    canUndo: false,
    undone: false,
  };
  const composer = () => screen.getByRole("region", { name: "Composer" });
  const input = () => screen.getByRole("textbox", { name: "Ask for a change" });
  const log = () => screen.getByRole("log", { name: "Conversation" });

  it("shows only the latest reply above it, which can be hidden", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} messages={[opening, { id: "m2", role: "USER", text: "Shorter please", targetUnit: "Summary", opening: false, canUndo: false, undone: false }]} />);
    // The opening message starts as one line, so it doesn't cover the document.
    expect(within(log()).getByText("Here's what I tailored for Ledgerly:")).toBeInTheDocument();
    expect(within(log()).queryByRole("listitem")).not.toBeInTheDocument();
    await user.click(within(log()).getByRole("button", { name: "Show" }));
    expect(within(log()).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Rewrote your summary", "Wrote a warm cover letter"]);
    expect(within(log()).queryByText("Shorter please")).not.toBeInTheDocument();
    await user.click(within(log()).getByRole("button", { name: "Hide this answer" }));
    expect(within(log()).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("changes its suggestions and placeholder with the tab, and only asks where there's nothing to change", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    expect(within(composer()).getByRole("button", { name: "Make the summary shorter" })).toBeInTheDocument();
    expect(input()).toHaveAttribute("placeholder", "Ask for a change to the resume, e.g. “sound more confident”");
    await user.click(screen.getByRole("tab", { name: "Cover letter" }));
    expect(within(composer()).getByRole("button", { name: "Make it more formal" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Job posting/ }));
    expect(within(composer()).getByRole("radio", { name: "Change" })).toBeDisabled();
    expect(within(composer()).getByRole("radio", { name: "Ask" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Ask a question" })).toHaveAttribute("placeholder", "Ask about this job, or how you fit it");
    expect(within(composer()).getByRole("button", { name: "What matters most to them?" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.queryByRole("region", { name: "Composer" })).not.toBeInTheDocument();
  });

  it("sends a suggestion about the document on screen, then thinks", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("button", { name: "Make the summary shorter" }));
    expect(sendMessage).toHaveBeenCalledWith({ id: "app-1", text: "Make the summary shorter", viewing: "RESUME", target: null, mode: "change" });
    expect(within(log()).getByText("Thinking…")).toBeInTheDocument();
  });

  it("asks a question in Ask, which changes nothing (public issue 132)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} application={{ ...props.application, status: "INTERVIEW" }} />);
    await user.click(within(composer()).getByRole("radio", { name: "Ask" }));
    const question = screen.getByRole("textbox", { name: "Ask a question" });
    expect(question).toHaveAttribute("placeholder", "Ask for help getting ready…");
    await user.type(question, "What might they ask me?{Enter}");
    expect(sendMessage).toHaveBeenCalledWith({ id: "app-1", text: "What might they ask me?", viewing: "RESUME", target: null, mode: "ask" });
  });

  it("sends with Enter and starts a new line with Shift+Enter", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.type(input(), "Sound more{Shift>}{Enter}{/Shift}confident");
    expect(input()).toHaveValue("Sound more\nconfident");
    await user.keyboard("{Enter}");
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Sound more\nconfident" }));
    expect(input()).toHaveValue("");
  });

  it("asks about a unit picked with Ask AI", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Ask AI" }));
    expect(input()).toHaveFocus();
    expect(input()).toHaveAttribute("placeholder", "What should change in the summary?");
    expect(within(composer()).getByText("About: Summary")).toBeInTheDocument();

    await user.type(input(), "Mention payments{Enter}");
    expect(sendMessage).toHaveBeenCalledWith({ id: "app-1", text: "Mention payments", viewing: "RESUME", target: { document: "RESUME", unitId: "summary" }, mode: "change" });
    expect(within(composer()).queryByRole("button", { name: "Stop asking about the summary" })).not.toBeInTheDocument();
  });

  it("drops the picked unit with ×", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Ask AI" }));
    await user.click(screen.getByRole("button", { name: "Stop asking about the summary" }));
    expect(input()).toHaveAttribute("placeholder", "Ask for a change to the resume, e.g. “sound more confident”");
  });

  it("shows the reply's edits, switching to the document they're on", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.type(input(), "Make the letter more formal{Enter}");
    report({ id: "reply-1", type: "refine", status: "DONE", result: { messageId: "m9", edited: [{ document: "COVER_LETTER", unitId: "paragraph:1" }] } });

    expect(router.refresh).toHaveBeenCalled();
    expect(within(log()).queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cover letter" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: demoLetterUnits()[0].label }).className).toMatch(/flash/);
  });

  it("lands a change: marks its new lines, with Keep and Undo (E30-12)", async () => {
    const user = userEvent.setup();
    const units = demoResumeUnits();
    const role = units.find((unit) => unit.id.startsWith("experience:"))!;
    const history = [{ kind: "change" as const, id: "v2", at: "2026-11-16T10:00:00.000Z", text: "Added it.", why: "Asked", versions: [{ document: "RESUME" as const, id: "v2", number: 2, previousId: "v1" }] }];
    const view = render(<ApplicationView {...props} />);
    await user.type(input(), "Mention the design system{Enter}");
    report({ id: "reply-1", type: "refine", status: "DONE", result: { messageId: "m9", edited: [{ document: "RESUME", unitId: role.id }] } });
    const added = "Built the design system across six product teams";
    const after = units.map((unit) => (unit.id === role.id ? { ...unit, text: `${unit.text}\n${added}` } : unit));
    view.rerender(<ApplicationView {...props} history={history} resume={{ ...props.resume!, units: after }} />);

    const frame = screen.getByRole("group", { name: role.label });
    expect(within(frame).getByRole("status")).toHaveTextContent("Changed just now");
    expect(within(frame).getByText(added)).toHaveAttribute("data-change");
    await user.click(within(frame).getByRole("button", { name: "Undo" }));
    expect(goBackTo).toHaveBeenCalledWith({ id: "app-1", versionIds: ["v1"] });
    expect(within(frame).queryByRole("status")).not.toBeInTheDocument();
  });

  it("selects the requirement a landed change serves (E30-12)", async () => {
    const user = userEvent.setup();
    const units = demoResumeUnits();
    const role = units.find((unit) => unit.id.startsWith("experience:"))!;
    const item = { skill: null, experienceIds: [], note: null };
    const match = { items: [{ ...item, requirement: "Payments", result: "gap" as const }, { ...item, requirement: "Figma", result: "covered" as const }] };
    const view = render(<ApplicationView {...props} match={match} />);
    await user.type(input(), "Mention payouts{Enter}");
    report({ id: "reply-1", type: "refine", status: "DONE", result: { messageId: "m9", edited: [{ document: "RESUME", unitId: role.id }] } });
    const added = "Designed payout flows";
    const after = units.map((unit) => (unit.id === role.id ? { ...unit, text: `${unit.text}\n${added}`, serves: [{ line: added, requirements: ["Payments"] }] } : unit));
    view.rerender(<ApplicationView {...props} match={match} resume={{ ...props.resume!, units: after }} />);
    const fit = screen.getByRole("complementary", { name: "How you fit" });
    expect(within(fit).getByRole("button", { name: /Payments/, pressed: true })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: role.label })).getByText(added)).toHaveAttribute("data-highlight");
  });

  it("keeps a landed change with Keep", async () => {
    const user = userEvent.setup();
    const view = render(<ApplicationView {...props} />);
    await user.type(input(), "Shorter{Enter}");
    report({ id: "reply-1", type: "refine", status: "DONE", result: { messageId: "m9", edited: [{ document: "RESUME", unitId: "summary" }] } });
    view.rerender(<ApplicationView {...props} resume={{ ...props.resume!, units: demoResumeUnits().map((unit) => (unit.id === "summary" ? { ...unit, text: "Shorter." } : unit)) }} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    expect(frame.className).toMatch(/landing/);
    await user.click(within(frame).getByRole("button", { name: "Keep" }));
    expect(frame.className).not.toMatch(/landing/);
  });

  it("keeps the message in the box when it can't be sent", async () => {
    const user = userEvent.setup();
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, error: "I'm still working on your last message." });
    render(<ApplicationView {...props} />);
    await user.type(input(), "Shorter{Enter}");
    expect(toast).toHaveBeenCalledWith("I'm still working on your last message.");
    expect(input()).toHaveValue("Shorter");
  });

  it("offers Retry when the reply fails", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.type(input(), "Shorter{Enter}");
    report({ id: "reply-1", type: "refine", status: "FAILED", error: "The AI server didn't answer in time." });
    expect(toast).toHaveBeenLastCalledWith("The AI server didn't answer in time.", { action: expect.objectContaining({ label: "Retry" }) });
    await act(async () => vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick());
    expect(retry).toHaveBeenCalledWith({ id: "reply-1" });
    expect(within(log()).getByText("Thinking…")).toBeInTheDocument();
  });

  it("keeps thinking about a reply started before a reload", () => {
    render(<ApplicationView {...props} refining="reply-7" />);
    expect(within(log()).getByText("Thinking…")).toBeInTheDocument();
  });

  it("points to Settings without an AI provider, and keeps what was typed", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} aiReady={false} />);
    expect(within(composer()).getByRole("link", { name: "Choose one in Settings" })).toHaveAttribute("href", "/settings?section=ai");
    await user.type(input(), "Shorter{Enter}");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Shorter");
  });
});

describe("the latest change and the history (E30-10, E30-11)", () => {
  const change = (id: string, text: string, at: string, versions: { id: string; previousId: string | null; number: number }[], why = "Asked") => ({
    kind: "change" as const,
    id,
    at,
    text,
    why,
    versions: versions.map((version) => ({ document: "RESUME" as const, ...version })),
  });
  const history = [
    change("v3", "Moved payments into the first sentence.", "2026-11-16T10:02:00.000Z", [{ id: "v3", previousId: "v2", number: 3 }]),
    { kind: "answer" as const, id: "m5", at: "2026-11-16T10:01:00.000Z", question: "What matters most?", text: "Design systems." },
    change("v2", "Rewrote “Summary”", "2026-11-16T10:00:00.000Z", [{ id: "v2", previousId: "v1", number: 2 }], "Regenerated"),
    change("v1", "Wrote the resume", "2026-11-15T10:00:00.000Z", [{ id: "v1", previousId: null, number: 1 }], "Tailoring"),
  ];
  const log = () => screen.getByRole("log", { name: "Conversation" });

  it("shows only the latest change above the composer, with Undo and how many are earlier", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} history={history} />);
    expect(within(log()).getByText("Moved payments into the first sentence.")).toBeInTheDocument();
    await user.click(within(log()).getByRole("button", { name: "Undo" }));
    expect(goBackTo).toHaveBeenCalledWith({ id: "app-1", versionIds: ["v2"] });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Undone. It's in the history if you want it back."));
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Summary" }).className).toMatch(/flash/);
  });

  it("opens the history with every change and answer: Undo on the latest, Go back to this on older ones", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} history={history} />);
    await user.click(within(log()).getByRole("button", { name: "3 earlier" }));
    const items = within(screen.getByRole("list", { name: "Changes" })).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("p:nth-child(2)")?.textContent)).toEqual(["Moved payments into the first sentence.", "What matters most?", "Rewrote “Summary”", "Wrote the resume"]);
    expect(items[0]).toHaveTextContent(/^Resume v3 · Asked ·/);
    expect(within(items[0]).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(within(items[1]).queryByRole("button")).not.toBeInTheDocument();
    await user.click(within(items[3]).getByRole("button", { name: /^Go back to this/ }));
    expect(goBackTo).toHaveBeenCalledWith({ id: "app-1", versionIds: ["v1"] });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "Changes" })).not.toBeInTheDocument();
  });

  it("opens it from a document's History · vN too", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} history={history} versions={{ RESUME: 3 }} />);
    await user.click(screen.getByRole("button", { name: "History · v3" }));
    expect(screen.getByRole("heading", { name: "History" })).toBeInTheDocument();
  });

  it("shows a newer reply that changed nothing instead, until it's hidden", async () => {
    const user = userEvent.setup();
    const declined = { id: "m9", role: "AI" as const, text: "Your profile doesn't mention Kubernetes.", targetUnit: null, opening: false, canUndo: false, undone: false, at: "2026-11-16T11:00:00.000Z" };
    render(<ApplicationView {...props} history={history} messages={[declined]} />);
    expect(within(log()).getByText("Your profile doesn't mention Kubernetes.")).toBeInTheDocument();
    expect(within(log()).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    await user.click(within(log()).getByRole("button", { name: "Hide this answer" }));
    expect(within(log()).getByText("Moved payments into the first sentence.")).toBeInTheDocument();
  });

  it("undoes a first change from the chat with its reply's own Undo, without an earlier version", async () => {
    const user = userEvent.setup();
    const first = [{ ...change("v1", "Trimmed your summary.", "2026-11-16T10:00:00.000Z", [{ id: "v1", previousId: null, number: 1 }]), messageId: "m3" }];
    render(<ApplicationView {...props} history={first} />);
    await user.click(within(log()).getByRole("button", { name: "Undo" }));
    expect(undoMessage).toHaveBeenCalledWith({ id: "app-1", messageId: "m3" });
    expect(goBackTo).not.toHaveBeenCalled();
  });

  it("explains when it can't go back", async () => {
    const user = userEvent.setup();
    vi.mocked(goBackTo).mockResolvedValueOnce({ ok: false, error: "That's how it is now already." });
    render(<ApplicationView {...props} history={history} />);
    await user.click(within(log()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("That's how it is now already."));
    expect(within(log()).getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});

describe("the Fit column and the Job posting tab (E8-7, E30-3)", () => {
  const requirements = [
    { text: "Strong prototyping skills in Figma", kind: "skill" as const, skill: "Figma", years: null, language: null },
    { text: "Experience with Kubernetes", kind: "skill" as const, skill: "Kubernetes", years: null, language: null },
  ];
  const match = {
    items: [
      { requirement: requirements[0].text, result: "covered" as const, skill: "Figma", experienceIds: ["e2"], note: "At Fieldnote" },
      { requirement: requirements[1].text, result: "gap" as const, skill: null, experienceIds: [], note: null, mustHave: true },
    ],
  };
  const open = (extra: Partial<ApplicationViewProps> = {}) =>
    render(<ApplicationView {...props} match={match} requirements={requirements} initialTab="posting" {...extra} />);
  const column = () => screen.getByRole("complementary", { name: "How you fit" });

  it("shows what they ask for beside the documents, with where each is covered", () => {
    open();
    const items = within(within(column()).getByRole("list", { name: "What they ask for" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "✓Covered: Strong prototyping skills in FigmaAt Fieldnote",
      "–Not covered: Experience with KubernetesNot in your profile · must-have · Add to profile · Mention in the letter",
    ]);
    expect(within(column()).getByText("Amsterdam")).toBeInTheDocument();
  });

  it("highlights every line that covers a picked requirement, and says which paragraph on the letter (E30-4)", async () => {
    const user = userEvent.setup();
    const units = demoResumeUnits();
    const role = units.find((unit) => unit.id.startsWith("experience:"))!;
    const line = role.text.split("\n")[0];
    const resume = { ...props.resume!, units: units.map((unit) => (unit.id === role.id ? { ...unit, serves: [{ line, requirements: [requirements[0].text] }] } : unit)) };
    const letterUnits = demoLetterUnits().map((unit, index) => (index === 1 ? { ...unit, serves: [{ line: unit.text, requirements: [requirements[0].text] }] } : unit));
    open({ resume, letter: { ...props.letter!, units: letterUnits }, initialTab: "resume" });

    // Only what the resume covers can be picked.
    expect(within(column()).queryByRole("button", { name: /Experience with Kubernetes/ })).not.toBeInTheDocument();
    await user.click(within(column()).getByRole("button", { name: /Strong prototyping skills in Figma/ }));
    expect(within(column()).getByRole("button", { name: /Strong prototyping skills in Figma/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: role.label })).getByText(line)).toHaveAttribute("data-highlight");

    await user.click(screen.getByRole("tab", { name: "Cover letter" }));
    expect(within(column()).getByText("Paragraph 2")).toBeInTheDocument();
    const second = screen.getByRole("group", { name: demoLetterUnits()[1].label });
    expect(second.querySelector("[data-highlight], [data-highlight-all]") ?? (second.hasAttribute("data-highlight-all") ? second : null)).not.toBeNull();
  });

  it("shows the rows of a document written before, without highlights", () => {
    open({ initialTab: "resume" });
    expect(within(column()).queryByRole("button", { name: /Strong prototyping skills in Figma/ })).not.toBeInTheDocument();
    expect(within(column()).getByText("At Fieldnote")).toBeInTheDocument();
  });

  it("adds a missing skill to the profile, in the role it was used in, and offers to rewrite that role (E30-5)", async () => {
    const user = userEvent.setup();
    const roles = [{ id: "e1", label: "Northwind Logistics, 2021 – now" }];
    const resume = { ...props.resume!, units: [...props.resume!.units, { id: "experience:e1", label: "Northwind role", text: "Led the portal" }] };
    open({ roles, resume });
    await user.click(within(column()).getByRole("button", { name: "Add to profile" }));
    const form = within(column()).getByRole("group", { name: "Add Kubernetes to your profile" });
    expect(within(form).getByLabelText("Where you used it")).toHaveFocus();
    await user.type(within(form).getByLabelText(/What you did with it/), "Set up the clusters");
    vi.mocked(addMatchSkill).mockResolvedValueOnce({ ok: true, data: { name: "Kubernetes", where: "Northwind Logistics", experienceId: "e1" } });
    await user.click(within(form).getByRole("button", { name: "Add to profile" }));
    expect(addMatchSkill).toHaveBeenCalledWith({ id: "app-1", index: 1, experienceId: "e1", did: "Set up the clusters" });
    expect(toast).toHaveBeenLastCalledWith("Added “Kubernetes” to your profile, at Northwind Logistics. Rewrite that role on the resume?", expect.objectContaining({ action: expect.objectContaining({ label: "Rewrite it" }) }));
    expect(within(column()).queryByRole("group", { name: "Add Kubernetes to your profile" })).not.toBeInTheDocument();
  });

  it("adds it to the skills only, without a role", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(column()).getByRole("button", { name: "Add to profile" }));
    await user.click(within(column()).getByRole("button", { name: "Add to profile" }));
    expect(addMatchSkill).toHaveBeenLastCalledWith({ id: "app-1", index: 1, experienceId: null, did: undefined });
    expect(toast).toHaveBeenLastCalledWith("Added “Kubernetes” to your skills. Attach it to a role under Experience to make it count.");
  });

  it("marks a gap the user doesn't have, and shows it so (E30-5)", async () => {
    const user = userEvent.setup();
    const view = open();
    await user.click(within(column()).getByRole("button", { name: "Add to profile" }));
    await user.click(within(column()).getByRole("button", { name: "I don't have this" }));
    expect(markKnownGap).toHaveBeenCalledWith({ id: "app-1", requirement: "Experience with Kubernetes" });
    view.rerender(<ApplicationView {...props} match={match} requirements={requirements} initialTab="posting" knownGaps={["Experience with Kubernetes"]} />);
    expect(within(column()).getByText("You don't have this")).toBeInTheDocument();
    expect(within(column()).queryByRole("button", { name: "Add to profile" })).not.toBeInTheDocument();
  });

  it("asks for a gap to be mentioned in the letter, honestly (E30-5)", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(column()).getByRole("button", { name: "Mention in the letter" }));
    expect(screen.getByRole("tab", { name: "Cover letter" })).toHaveAttribute("aria-selected", "true");
    expect(sendMessage).toHaveBeenLastCalledWith({
      id: "app-1",
      text: "Address “Experience with Kubernetes” honestly in the letter, without claiming I have it.",
      viewing: "COVER_LETTER",
      target: null,
      mode: "change",
    });
  });

  it("opens the column over the document from the narrow rail, and closes it with Esc", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Show how you fit: 1 of 2 requirements covered" }));
    const dialog = screen.getByRole("dialog", { name: "How you fit" });
    expect(within(dialog).getByRole("list", { name: "What they ask for" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the posting as pasted on its tab", () => {
    open();
    expect(screen.getByRole("heading", { name: "Original posting" })).toBeInTheDocument();
    expect(screen.getByText(/^Ledgerly is hiring\./)).toHaveClass("whitespace-pre-wrap");
    expect(screen.getByText("Pasted 27 Sep")).toBeInTheDocument();
  });

  it("links to the saved posting in a new tab", () => {
    open({ posting: { ...props.posting, url: "https://jobs.ledgerly.com/senior-designer" } });
    const link = within(screen.getByRole("tabpanel")).getByRole("link", { name: "jobs.ledgerly.com/senior-designer (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "https://jobs.ledgerly.com/senior-designer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("says so when it wasn't matched", () => {
    open({ match: null });
    expect(within(column()).getByText("No requirements from the posting yet.")).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).queryByRole("link", { name: /opens in a new tab/ })).not.toBeInTheDocument();
  });
});

describe("downloading PDFs (E8-8)", () => {
  it("downloads each document from its own toolbar (E30-2)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    expect(screen.getByRole("link", { name: "Download the tailored resume as a PDF" })).toHaveAttribute("href", "/api/pdf?doc=resume&application=app-1");
    await user.click(screen.getByRole("tab", { name: "Cover letter" }));
    expect(screen.getByRole("link", { name: "Download the cover letter as a PDF" })).toHaveAttribute("href", "/api/pdf?doc=letter&application=app-1");
  });

  it("isn't offered without documents", () => {
    render(<ApplicationView {...props} resume={null} letter={null} />);
    expect(screen.queryByRole("link", { name: /PDF/ })).not.toBeInTheDocument();
  });
});

describe("notes and activity (E8-9)", () => {
  const activity = [
    { kind: "note" as const, id: "n1", body: "Called John.\nSecond round next week.", date: "3 Oct", edited: false },
    { kind: "status" as const, id: "e2", status: "INTERVIEW" as const, date: "3 Oct" },
    { kind: "note" as const, id: "n2", body: "Sent a thank-you.", date: "1 Oct", edited: true },
    { kind: "status" as const, id: "e1", status: "SENT" as const, date: "1 Oct" },
    { kind: "created" as const, id: "created" as const, date: "28 Sep" },
  ];
  const open = () => render(<ApplicationView {...props} activity={activity} initialTab="notes" />);
  const timeline = () => screen.getByRole("list", { name: "Notes and activity" });

  beforeEach(() => {
    vi.mocked(addNote).mockClear();
    vi.mocked(updateNote).mockClear();
    vi.mocked(deleteNote).mockClear();
    vi.mocked(restoreNote).mockClear();
  });

  it("has a Notes tab", () => {
    open();
    expect(screen.getByRole("tab", { name: "Notes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Private and never sent to the AI")).toBeInTheDocument();
  });

  it("shows notes and status changes in one timeline, newest first", () => {
    open();
    const items = within(timeline()).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Called John.\nSecond round next week.3 OctEditDelete",
      "Moved to Interview3 Oct",
      "Sent a thank-you.1 Oct · editedEditDelete",
      "Moved to Sent1 Oct",
      "Created28 Sep",
    ]);
  });

  it("adds a note", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("Add a note"), "Recruiter said salary is flexible.");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(addNote).toHaveBeenCalledWith({ id: "app-1", body: "Recruiter said salary is flexible." });
    expect(screen.getByLabelText("Add a note")).toHaveValue("");
  });

  it("edits a note in place", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Edit the note from 1 Oct" }));
    const box = screen.getByRole("textbox", { name: "Edit note" });
    expect(box).toHaveFocus();
    await user.type(box, " And a follow-up.");
    await user.click(within(timeline()).getByRole("button", { name: "Save" }));
    expect(updateNote).toHaveBeenCalledWith({ id: "app-1", noteId: "n2", body: "Sent a thank-you. And a follow-up." });
  });

  it("deletes a note with Undo on the toast", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Delete the note from 3 Oct" }));
    expect(deleteNote).toHaveBeenCalledWith({ id: "app-1", noteId: "n1" });
    expect(toast).toHaveBeenLastCalledWith("Note deleted.", { action: expect.objectContaining({ label: "Undo" }) });
    await act(async () => vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick());
    expect(restoreNote).toHaveBeenCalledWith({
      id: "app-1",
      body: "Called John.",
      createdAt: "2026-10-03T13:00:00.000Z",
      updatedAt: "2026-10-03T13:00:00.000Z",
    });
  });

  it("has no composer beside the notes, which never go to the AI (E30-10)", () => {
    open();
    expect(screen.queryByRole("region", { name: "Composer" })).not.toBeInTheDocument();
  });
});

describe("one-page trimming on the Resume tab (E10-10)", () => {
  it("lists what was left out, each with Put back", async () => {
    const user = userEvent.setup();
    const trimmed = [
      { kind: "unit" as const, unit: { id: "experience:e3", label: "Studio Brik role", text: "Built things" }, index: 3 },
      { kind: "bullets" as const, unitId: "experience:e2", label: "Fieldnote role", lines: ["Ran research"] },
    ];
    render(<ApplicationView {...props} resume={{ units: demoResumeUnits(), theme: theme("editorial"), trimmed }} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Left out to fit the page limit:Studio Brik rolePut back1 bullet from the Fieldnote rolePut back");
    await user.click(within(note).getByRole("button", { name: "Put back 1 bullet from the Fieldnote role" }));
    expect(putBackTrimmed).toHaveBeenCalledWith({ id: "app-1", index: 1 });
    expect(toast).toHaveBeenLastCalledWith("Put back.");
  });

  it("lists parts left out by hand with them, and says which the page limit left out (#217)", async () => {
    const user = userEvent.setup();
    const trimmed = [
      { kind: "unit" as const, unit: { id: "experience:e3", label: "Studio Brik role", text: "Built things" }, index: 3 },
      { kind: "unit" as const, unit: { id: "languages", label: "Languages", text: "Dutch: Native" }, index: 9, byHand: true as const },
    ];
    render(<ApplicationView {...props} resume={{ units: demoResumeUnits(), theme: theme("editorial"), trimmed }} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Left out of this resume:Studio Brik role · to fit the page limitPut backLanguagesPut back");
    await user.click(within(note).getByRole("button", { name: "Put back the Languages" }));
    expect(putBackTrimmed).toHaveBeenCalledWith({ id: "app-1", index: 1 });
    expect(toast).toHaveBeenLastCalledWith("Put back.");
  });

  it("says nothing when nothing was left out", () => {
    render(<ApplicationView {...props} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("the Email tab", () => {
  const email = [
    { id: "to", label: "Recipient", text: "John Doe <john@example.com>" },
    { id: "subject", label: "Subject", text: "Application: Senior Product Designer, Jane Doe" },
    { id: "body", label: "Message", text: "Dear John,\n\nI'd love to bring calm to Ledgerly's payments.\n\nWarm regards,\nJane Doe" },
  ];
  const toastAction = () => vi.mocked(toast).mock.lastCall?.[1]?.action;

  it("offers to write the email, then shows it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ApplicationView {...props} initialTab="email" />);
    await user.click(screen.getByRole("button", { name: "Write the email" }));
    expect(startWritingEmail).toHaveBeenCalledWith({ id: "app-1" });
    expect(screen.getByRole("button", { name: "Writing the email…" })).toHaveAttribute("aria-disabled", "true");

    report({ id: "email-1", type: "write-email", status: "DONE", result: { units: email, previous: null } });
    expect(router.refresh).toHaveBeenCalled();
    // The first email just appears.
    expect(toast).not.toHaveBeenCalled();
    rerender(<ApplicationView {...props} initialTab="email" email={email} />);
    const article = screen.getByRole("article", { name: "Email" });
    expect(within(article).getByRole("group", { name: "Recipient" })).toHaveTextContent("John Doe <john@example.com>");
    expect(within(article).getByRole("group", { name: "Subject" })).toHaveTextContent("Application: Senior Product Designer, Jane Doe");
    expect(within(article).getByRole("group", { name: "Message" })).toHaveTextContent("I'd love to bring calm to Ledgerly's payments.");
  });

  it("points to Settings without an AI provider", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" aiReady={false} />);
    await user.click(screen.getByRole("button", { name: "Write the email" }));
    expect(startWritingEmail).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith("That needs an AI provider. Choose one in Settings → AI provider.", {
      action: expect.objectContaining({ label: "Open Settings" }),
    });
  });

  it("keeps writing one started before a reload", () => {
    render(<ApplicationView {...props} initialTab="email" writingEmail="email-7" />);
    expect(screen.getByRole("button", { name: "Writing the email…" })).toBeInTheDocument();
  });

  it("copies each part and opens the email in the mail app", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    await user.click(screen.getByRole("button", { name: "Copy the recipient" }));
    expect(copyText).toHaveBeenLastCalledWith("John Doe <john@example.com>");
    await user.click(screen.getByRole("button", { name: "Copy the subject" }));
    expect(copyText).toHaveBeenLastCalledWith("Application: Senior Product Designer, Jane Doe");
    expect(toast).toHaveBeenLastCalledWith("Copied the subject.");
    await user.click(screen.getByRole("button", { name: "Copy message" }));
    expect(copyText).toHaveBeenLastCalledWith(email[2].text);

    const mailto = screen.getByRole("link", { name: "Open in mail app" }).getAttribute("href")!;
    expect(mailto).toMatch(/^mailto:john@example\.com\?subject=Application%3A%20Senior/);
    expect(mailto).toContain("body=Dear%20John%2C%0D%0A%0D%0AI'd%20love");
  });

  it("lists the resume and cover letter to attach, each with its download", () => {
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    expect(screen.getByRole("link", { name: "Download Jane Doe – Ledgerly – Resume.pdf" })).toHaveAttribute(
      "href",
      "/api/pdf?doc=resume&application=app-1",
    );
    expect(screen.getByRole("link", { name: "Download Jane Doe – Ledgerly – Cover letter.pdf" })).toHaveAttribute(
      "href",
      "/api/pdf?doc=letter&application=app-1",
    );
  });

  it("says when the posting gives no address, and only edits the recipient", () => {
    render(<ApplicationView {...props} initialTab="email" email={[{ ...email[0], text: "" }, email[1], email[2]]} />);
    const recipient = screen.getByRole("group", { name: "Recipient" });
    expect(recipient).toHaveTextContent("The posting doesn't give an address. Edit to add one.");
    expect(within(recipient).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit"]);
    expect(screen.queryByRole("button", { name: "Copy the recipient" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Subject" })).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Edit",
      "Regenerate",
      "Ask AI",
    ]);
  });

  it("rewrites it, with Undo on the toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    await user.click(screen.getByRole("button", { name: "Write it again" }));
    expect(startWritingEmail).toHaveBeenCalledWith({ id: "app-1" });
    expect(screen.getByRole("article", { name: "Email" })).toHaveAttribute("aria-busy", "true");

    report({ id: "email-1", type: "write-email", status: "DONE", result: { units: email, previous: email } });
    expect(screen.getByRole("group", { name: "Message" }).className).toMatch(/flash/);
    expect(toast).toHaveBeenLastCalledWith("Rewrote the email.", { action: expect.objectContaining({ label: "Undo" }) });
    await act(async () => toastAction()?.onClick());
    expect(undoEmailRewrite).toHaveBeenCalledWith({ id: "app-1", jobId: "email-1" });
    expect(toast).toHaveBeenLastCalledWith("Put the email back.");
  });

  it("offers Retry when writing fails", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" />);
    await user.click(screen.getByRole("button", { name: "Write the email" }));
    report({ id: "email-1", type: "write-email", status: "FAILED", error: "The AI server didn't answer in time." });
    expect(screen.getByRole("button", { name: "Write the email" })).toBeInTheDocument();
    expect(toast).toHaveBeenLastCalledWith("The AI server didn't answer in time.", { action: expect.objectContaining({ label: "Retry" }) });
    await act(async () => toastAction()?.onClick());
    expect(retry).toHaveBeenCalledWith({ id: "email-1" });
    expect(screen.getByRole("button", { name: "Writing the email…" })).toBeInTheDocument();
  });

  it("refines the email from the chat once there is one", async () => {
    const user = userEvent.setup();
    const composer = () => screen.getByRole("region", { name: "Composer" });
    const { unmount } = render(<ApplicationView {...props} initialTab="email" />);
    expect(within(composer()).queryByRole("button", { name: "Shorter, under 100 words" })).not.toBeInTheDocument();
    unmount();

    render(<ApplicationView {...props} initialTab="email" email={email} />);
    expect(screen.getByRole("textbox", { name: "Ask for a change" })).toHaveAttribute("placeholder", "Ask for a change to the email, e.g. “shorter”");
    await user.click(within(composer()).getByRole("button", { name: "Shorter, under 100 words" }));
    expect(sendMessage).toHaveBeenCalledWith({ id: "app-1", text: "Shorter, under 100 words", viewing: "EMAIL", target: null, mode: "change" });
  });

  it("switches to the email when a reply changed it", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} email={email} />);
    await user.type(screen.getByRole("textbox", { name: "Ask for a change" }), "Make the email shorter{Enter}");
    report({ id: "reply-1", type: "refine", status: "DONE", result: { messageId: "m9", edited: [{ document: "EMAIL", unitId: "body" }] } });
    expect(screen.getByRole("tab", { name: /^Email/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "Message" }).className).toMatch(/flash/);
  });

  it("opens the one history from its History (E30-11)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("heading", { name: "History" })).toBeInTheDocument();
  });
});

describe("letterPlaces (E30-4)", () => {
  it("names the paragraphs that cover each requirement, and says when a gap is addressed", () => {
    const item = { skill: null, experienceIds: [], note: null };
    const match = {
      items: [
        { ...item, requirement: "Design systems", result: "covered" as const },
        { ...item, requirement: "Figma", result: "covered" as const },
        { ...item, requirement: "Payments", result: "gap" as const },
      ],
    };
    const units = [
      { id: "greeting", label: "Greeting", text: "Dear team," },
      { id: "paragraph:1", label: "Opening", text: "One.", serves: [{ line: "One.", requirements: ["Design systems"] }] },
      { id: "paragraph:2", label: "Middle", text: "Two.", serves: [{ line: "Two.", requirements: ["Design systems", "Payments"] }] },
    ];
    expect(letterPlaces(match, units)).toEqual({
      "Design systems": "Paragraphs 1 and 2",
      Figma: "Not in the letter, resume only",
      Payments: "Addressed in paragraph 2",
    });
  });
});

describe("the Interview column (E30-6)", () => {
  const interviews = [
    { id: "i1", round: 1, at: "2026-11-25T10:00:00.000Z", minutes: 30, place: "", people: "Lotte de Vries", notes: "Friendly screening.", prep: null },
    {
      id: "i2",
      round: 2,
      at: "2030-12-03T10:00:00.000Z",
      minutes: 60,
      place: "Google Meet",
      people: "Lotte de Vries, Design Director\nRuben Kok",
      notes: "",
      prep: [
        { text: "Reread the posting and your letter", why: "From the posting", done: true, doneAt: "2026-11-30T09:00:00.000Z" },
        { text: "A payments story for the fintech gap", why: "For the payments gap", done: false },
      ],
    },
  ];
  const item = { skill: null, experienceIds: [], note: null };
  const match = { items: [{ ...item, requirement: "Figma", result: "covered" as const }, { ...item, requirement: "Payments", result: "gap" as const }] };
  const open = (extra: Partial<ApplicationViewProps> = {}) =>
    render(<ApplicationView {...props} application={{ ...props.application, status: "INTERVIEW" }} match={match} interviews={interviews} timeZone="UTC" {...extra} />);
  const column = () => screen.getByRole("complementary", { name: "How you fit" });

  beforeEach(() => {
    vi.mocked(startPreparing).mockClear();
    vi.mocked(tickPrep).mockClear();
  });

  it("shows the next round, Getting ready with its ticks, and So far", () => {
    open();
    expect(within(column()).getByText("Next interview · round 2")).toBeInTheDocument();
    expect(within(column()).getByText("60 min · Google Meet")).toBeInTheDocument();
    expect(within(column()).getByText("Ruben Kok")).toBeInTheDocument();
    expect(within(column()).getByRole("checkbox", { name: "Reread the posting and your letter" })).toBeChecked();
    expect(within(column()).getByText(/^Done /)).toBeInTheDocument();
    expect(within(column()).getByText("For the payments gap")).toBeInTheDocument();
    expect(within(column()).getByText(/Round 1 with Lotte de Vries/)).toBeInTheDocument();
    expect(within(column()).getByText("1 of 2 requirements covered", { exact: false })).toBeInTheDocument();
  });

  it("ticks an item", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(column()).getByRole("checkbox", { name: "A payments story for the fintech gap" }));
    expect(tickPrep).toHaveBeenCalledWith({ id: "app-1", interviewId: "i2", index: 1, done: true });
  });

  it("writes Getting ready only when Prepare is clicked", async () => {
    const user = userEvent.setup();
    open({ interviews: [{ ...interviews[1], prep: null }] });
    expect(startPreparing).not.toHaveBeenCalled();
    await user.click(within(column()).getByRole("button", { name: "Prepare" }));
    expect(startPreparing).toHaveBeenCalledWith({ id: "app-1" });
    expect(await within(column()).findByRole("button", { name: "Getting you ready…" })).toBeInTheDocument();
  });

  it("writes it from the header's Prepare too", async () => {
    const user = userEvent.setup();
    open({ interviews: [{ ...interviews[1], prep: null }] });
    const header = screen.getAllByRole("button", { name: "Prepare" }).find((button) => !column().contains(button))!;
    await user.click(header);
    expect(startPreparing).toHaveBeenCalledWith({ id: "app-1" });
  });

  it("starts it when a Prepare button elsewhere opened the page", async () => {
    open({ interviews: [{ ...interviews[1], prep: null }], start: "prepare" });
    await waitFor(() => expect(startPreparing).toHaveBeenCalledWith({ id: "app-1" }));
  });

  it("shows the fit on Show, and goes back", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(column()).getByRole("button", { name: "Show" }));
    expect(within(column()).getByRole("list", { name: "What they ask for" })).toBeInTheDocument();
    await user.click(within(column()).getByRole("button", { name: "← Back to the interview" }));
    expect(within(column()).getByText("Next interview · round 2")).toBeInTheDocument();
  });
});

describe("the Offer column and drafted messages (E30-7, E30-8)", () => {
  const offer = { salary: "€82,500", decideBy: "2026-11-20", startDate: "2027-02-01", holidays: "27 days", office: "Hybrid, 3 days", fromEmail: true };
  const open = (extra: Partial<ApplicationViewProps> = {}) =>
    render(<ApplicationView {...props} application={{ ...props.application, status: "OFFER", salary: "€75,000–€90,000" }} offer={offer} {...extra} />);
  const column = () => screen.getByRole("complementary", { name: "How you fit" });

  beforeEach(() => {
    vi.mocked(startWritingMessage).mockClear();
    vi.mocked(markMessageSent).mockClear();
  });

  it("shows the salary, where it falls on the posted range, and Decide by", () => {
    open();
    expect(within(column()).getByText("€82,500")).toBeInTheDocument();
    expect(within(column()).getByRole("img", { name: "Posted range €75,000–€90,000; the offer is 50% of the way up" })).toBeInTheDocument();
    expect(within(column()).getByText("27 days")).toBeInTheDocument();
    expect(within(column()).getByText(/read from their email/)).toBeInTheDocument();
  });

  it("drafts an answer on its click, with the email when there's no Gmail thread", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(column()).getByRole("button", { name: "Draft an acceptance" }));
    expect(startWritingMessage).toHaveBeenCalledWith({ id: "app-1", kind: "accept" });
    expect(screen.getByRole("tab", { name: /^Email/ })).toHaveAttribute("aria-selected", "true");
  });

  it("shows a drafted message to copy, and I sent it", async () => {
    const user = userEvent.setup();
    const messageDraft = { kind: "decline" as const, to: "careers@ledgerly.example", subject: "Re: Offer", body: "Thank you, but…", writtenWith: "write-message@1", at: "2026-11-17T10:00:00.000Z" };
    open({ messageDraft, initialTab: "email" });
    const card = screen.getByRole("region", { name: "Declining politely" });
    expect(within(card).getByRole("textbox", { name: "Message" })).toHaveValue("Thank you, but…");
    expect(within(card).getByRole("link", { name: "Open in mail app" })).toHaveAttribute("href", expect.stringMatching(/^mailto:careers@ledgerly\.example\?/));
    await user.click(within(card).getByRole("button", { name: "I sent it" }));
    expect(markMessageSent).toHaveBeenCalledWith({ id: "app-1" });
  });

  it("offers Send reply instead when it can go out in the Gmail thread", () => {
    const messageDraft = { kind: "accept" as const, to: "", subject: "Re: Offer", body: "Yes!", writtenWith: "write-message@1", at: "2026-11-17T10:00:00.000Z" };
    const gmail = { sender: { from: "jane@gmail.com" }, sentBefore: true, emails: [], moveTo: [], reading: true };
    open({ messageDraft, initialTab: "conversation", threadReady: true, gmail });
    const card = screen.getByRole("region", { name: "Your acceptance" });
    expect(within(card).getByRole("button", { name: "Send reply" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "I sent it" })).not.toBeInTheDocument();
  });
});

describe("a follow-up (E30-8)", () => {
  const quiet = { kind: "quiet" as const, text: "Quiet for 14 days", due: null, soon: true };

  beforeEach(() => vi.mocked(startWritingMessage).mockClear());

  it("drafts one from the header's next step, on the click", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} application={{ ...props.application, status: "SENT" }} flag={quiet} />);
    expect(startWritingMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Draft a follow-up" }));
    expect(startWritingMessage).toHaveBeenCalledWith({ id: "app-1", kind: "follow-up" });
    expect(screen.getByRole("tab", { name: /^Email/ })).toHaveAttribute("aria-selected", "true");
  });

  it("drafts one when a Follow up button elsewhere opened the page", async () => {
    render(<ApplicationView {...props} application={{ ...props.application, status: "SENT" }} flag={quiet} start="follow-up" />);
    await waitFor(() => expect(startWritingMessage).toHaveBeenCalledWith({ id: "app-1", kind: "follow-up" }));
    expect(screen.getByRole("tab", { name: /^Email/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("writing a new application's documents (E31-5)", () => {
  const requirements = [
    { text: "Strong prototyping skills in Figma", kind: "skill" as const, skill: "Figma", years: null, language: null },
    { text: "Design systems", kind: "skill" as const, skill: null, years: null, language: null },
    { text: "Experience with Kubernetes", kind: "skill" as const, skill: "Kubernetes", years: null, language: null },
  ];
  const match = {
    items: [
      { requirement: requirements[0].text, result: "covered" as const, skill: "Figma", experienceIds: ["e2"], note: "At Fieldnote" },
      { requirement: requirements[1].text, result: "covered" as const, skill: null, experienceIds: [], note: "At Northwind" },
      { requirement: requirements[2].text, result: "gap" as const, skill: null, experienceIds: [], note: null, mustHave: true },
    ],
  };
  const writing = { jobId: "write-1", write: "both" as const, notifies: true };
  const step = (name: string) => report({ id: "write-1", type: "write-application", step: name });
  const column = () => screen.getByRole("complementary", { name: "How you fit" });

  beforeEach(() => {
    router.refresh.mockReset();
    vi.mocked(toast).mockReset();
  });

  it("fills the resume in where it will be, with the steps above it, and says you can leave", () => {
    render(<ApplicationView {...props} resume={null} letter={null} match={match} requirements={requirements} writingApplication={writing} />);
    step("Writing the resume");
    expect(screen.getByRole("status", { name: "Writing" })).toHaveTextContent("Writing your resumeStep 3 of 5");
    expect(screen.getByText("Writing the resume").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Your tailored resume is being written.")).toBeInTheDocument();
    expect(screen.getByText("You can leave this page. It shows as a Draft on the board, and I'll let you know when it's done.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Writing…" })).toHaveAttribute("aria-disabled", "true");
    // Nothing to ask for while it writes.
    expect(screen.queryByRole("textbox", { name: "Ask for a change" })).not.toBeInTheDocument();
    expect(within(column()).getAllByText("Not used yet")).toHaveLength(2);
    expect(within(column()).getByText("For the letter, next")).toBeInTheDocument();
  });

  it("doesn't promise a notification no channel will send", () => {
    render(<ApplicationView {...props} resume={null} letter={null} writingApplication={{ ...writing, notifies: false }} />);
    expect(screen.getByText("You can leave this page. It shows as a Draft on the board, and keeps writing.")).toBeInTheDocument();
  });

  it("brings each document in as it lands, and marks what the resume uses", () => {
    const units = demoResumeUnits();
    const role = units.find((unit) => unit.id.startsWith("experience:"))!;
    const line = role.text.split("\n")[0];
    const resume = { ...props.resume!, units: units.map((unit) => (unit.id === role.id ? { ...unit, serves: [{ line, requirements: [requirements[0].text] }] } : unit)) };
    const { rerender } = render(<ApplicationView {...props} resume={null} letter={null} match={match} requirements={requirements} writingApplication={writing} />);
    step("Writing the resume");
    expect(router.refresh).not.toHaveBeenCalled();
    step("Writing the letter");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    rerender(<ApplicationView {...props} resume={resume} letter={null} match={match} requirements={requirements} writingApplication={writing} />);
    expect(screen.getByRole("article", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Writing" })).toHaveTextContent("Writing your letterStep 4 of 5");
    expect(within(column()).getByText("Used in the resume")).toHaveClass("text-success");
    expect(within(column()).getByText("Not in the resume")).toBeInTheDocument();
    expect(within(column()).getByText("1 of 3 used in the resume so far")).toBeInTheDocument();
  });

  it("leaves the rows as they were when the resume doesn't say what its lines serve", () => {
    render(<ApplicationView {...props} letter={null} match={match} requirements={requirements} writingApplication={writing} />);
    expect(within(column()).getByText("At Fieldnote")).toBeInTheDocument();
    expect(within(column()).queryByText("Not in the resume")).not.toBeInTheDocument();
    expect(within(column()).queryByText(/used in the resume so far/)).not.toBeInTheDocument();
  });

  it("opens the application as usual once it's done", () => {
    render(<ApplicationView {...props} match={match} requirements={requirements} writingApplication={writing} />);
    report({ id: "write-1", type: "write-application", status: "DONE", step: "Checking every line against your profile" });
    expect(toast).toHaveBeenCalledWith("Your application is ready. Nothing gets sent until you say so.");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: "Writing" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ask for a change" })).toBeInTheDocument();
  });

  it("stops on Stop, keeping what's written", async () => {
    render(<ApplicationView {...props} resume={null} letter={null} writingApplication={writing} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopWritingApplication).toHaveBeenCalledWith({ id: "app-1" });
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeInTheDocument();
    report({ id: "write-1", type: "write-application", status: "FAILED", error: "Cancelled." });
    expect(toast).toHaveBeenCalledWith("Stopped. What's written stays.");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByText(/^You can leave this page/)).not.toBeInTheDocument();
  });

  it("says why it stopped when writing fails", () => {
    render(<ApplicationView {...props} resume={null} letter={null} writingApplication={writing} />);
    report({ id: "write-1", type: "write-application", status: "FAILED", error: "The model took too long to answer." });
    expect(toast).toHaveBeenCalledWith("The model took too long to answer. What's written stays: write the rest from here.");
  });
});
