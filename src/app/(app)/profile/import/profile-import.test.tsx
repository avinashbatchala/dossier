import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { ActionResult } from "@/lib/action";
import { LanguageLevel } from "@/generated/prisma/enums";
import { useJob } from "@/hooks/use-job";
import type { ImportedProfile } from "@/lib/profile-import";

import { applyProfileImport, discardProfileImport } from "../actions";

import { ProfileImport } from "./profile-import";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
vi.mock("@/hooks/use-job", () => ({ useJob: vi.fn(() => null) }));
vi.mock("@/lib/jobs/actions", () => ({ retry: vi.fn() }));
vi.mock("../actions", () => ({
  applyProfileImport: vi.fn(async () => ({ ok: true, data: null })),
  discardProfileImport: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => {
  const toast = vi.fn();
  return {
    toast,
    toastResult: <T,>(result: ActionResult<T>) => {
      if (!result.ok) toast(result.error);
      return result;
    },
  };
});

const profile: ImportedProfile = {
  basics: { name: "John Doe", city: "Utrecht" },
  skills: [
    { name: "Figma", found: true },
    { name: "Service design", found: false },
  ],
  languages: [{ name: "German", level: LanguageLevel.B2, levelGiven: false }],
  experience: [
    {
      role: "Design Lead",
      company: "Acme Payments",
      location: "Utrecht",
      bullets: "Led the redesign\nSet up the design system",
      skills: ["Figma"],
      startYear: 2021,
      startMonth: 3,
      endYear: null,
      endMonth: null,
      current: true,
      unverified: ["Acme Payments"],
    },
  ],
  projects: [],
  education: [],
  references: [],
};
const done = { id: "job-1", type: "import-profile", status: "DONE", step: null, error: null, result: { profile, readWith: "extract-profile@1" } } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useJob).mockReturnValue(null);
});

describe("ProfileImport (E4-10)", () => {
  it("says where a hosted provider sends the resume, and needs a provider at all", () => {
    const { unmount } = render(<ProfileImport keptFor="24 hours" aiReady provider="ANTHROPIC" initialJobId={null} />);
    expect(screen.getByRole("note")).toHaveTextContent("contact details included, is sent to Anthropic");
    expect(screen.getByText(/The file's text is deleted once you've chosen, or after 24 hours if you don't\./)).toBeInTheDocument();
    unmount();
    render(<ProfileImport keptFor="24 hours" aiReady={false} provider="LOCAL" initialJobId={null} />);
    expect(screen.getByRole("note")).toHaveTextContent("No AI provider is set up yet");
    expect(screen.getByRole("button", { name: "Read my resume →" })).toHaveAttribute("aria-disabled", "true");
  });

  it("sends the chosen file and follows the reading in the address", async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ jobId: "job-1" }));
    render(<ProfileImport keptFor="24 hours" aiReady provider="LOCAL" initialJobId={null} />);
    const file = new File(["%PDF-"], "resume.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Your resume, as PDF, Word (.docx) or Markdown (.md)"), file);
    await user.click(screen.getByRole("button", { name: "Read my resume →" }));
    expect(fetch).toHaveBeenCalledWith("/api/profile/import", expect.objectContaining({ method: "POST", body: file }));
    expect(router.replace).toHaveBeenCalledWith("/profile/import?job=job-1");
    expect(screen.getByRole("heading", { name: "Reading your resume…" })).toBeInTheDocument();
  });

  it("shows why a file can't be read", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error: "Choose a PDF, a Word (.docx) or a Markdown (.md) file." }, { status: 400 }));
    render(<ProfileImport keptFor="24 hours" aiReady provider="LOCAL" initialJobId={null} />);
    await user.upload(screen.getByLabelText("Your resume, as PDF, Word (.docx) or Markdown (.md)"), new File(["x"], "resume.pdf"));
    await user.click(screen.getByRole("button", { name: "Read my resume →" }));
    expect(toast).toHaveBeenCalledWith("Choose a PDF, a Word (.docx) or a Markdown (.md) file.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("previews what was found, marking what isn't in the file, and merges", async () => {
    const user = userEvent.setup();
    vi.mocked(useJob).mockReturnValue(done as never);
    render(<ProfileImport keptFor="24 hours" aiReady provider="LOCAL" initialJobId="job-1" />);
    expect(screen.getByRole("heading", { name: "Here's what your resume says" })).toBeInTheDocument();
    expect(screen.getByText(/^1 role, 0 projects, 0 degrees, 2 skills, 1 language, 0 references\./)).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Service design")).toHaveTextContent("Service design check: not in the file");
    expect(screen.getByText("Design Lead · Acme Payments")).toHaveTextContent("check: “Acme Payments” not in the file");
    expect(screen.getByText(/^German/)).toHaveTextContent("(no level given; change it any time)");

    await user.click(screen.getByRole("button", { name: "Merge into my profile" }));
    expect(applyProfileImport).toHaveBeenCalledWith({ jobId: "job-1", mode: "merge" });
    expect(router.push).toHaveBeenCalledWith("/profile");
  });

  it("deletes the reading when another file is chosen", async () => {
    const user = userEvent.setup();
    vi.mocked(useJob).mockReturnValue(done as never);
    render(<ProfileImport keptFor="24 hours" aiReady provider="LOCAL" initialJobId="job-1" />);
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(discardProfileImport).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(router.replace).toHaveBeenCalledWith("/profile/import");
  });

  it("asks before replacing the profile", async () => {
    const user = userEvent.setup();
    vi.mocked(useJob).mockReturnValue(done as never);
    render(<ProfileImport keptFor="24 hours" aiReady provider="LOCAL" initialJobId="job-1" />);
    await user.click(screen.getByRole("button", { name: "Replace my profile…" }));
    expect(applyProfileImport).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Replace my profile" }));
    expect(applyProfileImport).toHaveBeenCalledWith({ jobId: "job-1", mode: "replace" });
  });
});
