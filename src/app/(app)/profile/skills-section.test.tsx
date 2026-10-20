import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { ProfileData } from "@/lib/profile";

import { addLanguage, addSkill, removeLanguage, removeSkill, setLanguageLevel } from "./actions";
import { SkillsSection } from "./skills-section";

vi.mock("./actions", () => ({
  addSkill: vi.fn(),
  removeSkill: vi.fn(),
  addLanguage: vi.fn(),
  setLanguageLevel: vi.fn(),
  removeLanguage: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const span = { startYear: null, startMonth: null, endYear: null, endMonth: null, current: false };
const profile = (): ProfileData => ({
  basics: {} as ProfileData["basics"],
  skills: [
    { id: "s1", name: "Figma" },
    { id: "s2", name: "User research" },
  ],
  languages: [{ id: "l1", name: "Dutch", level: "NATIVE" }],
  experience: [
    { id: "e1", role: "A", company: "", location: "", bullets: "", skillIds: ["s1", "s2"], ...span },
    { id: "e2", role: "B", company: "", location: "", bullets: "", skillIds: ["s1"], ...span },
  ],
  projects: [],
  education: [],
  references: [],
});

let latest: ProfileData;
function Harness() {
  const [state, setState] = useState(profile);
  useEffect(() => {
    latest = state;
  });
  return <SkillsSection profile={state} update={(change) => setState(change)} />;
}

describe("Skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(removeSkill).mockResolvedValue({ ok: true, data: null });
  });

  it("shows how many roles use each skill", () => {
    render(<Harness />);
    expect(screen.getByText("2 added")).toBeInTheDocument();
    const chips = within(screen.getByRole("list", { name: "Your skills" })).getAllByRole("listitem");
    expect(chips[0]).toHaveTextContent("Figma2 roles");
    expect(chips[1]).toHaveTextContent("User research1 role");
  });

  it("adds a skill with Enter", async () => {
    const user = userEvent.setup();
    vi.mocked(addSkill).mockResolvedValue({ ok: true, data: { added: true, skill: { id: "s3", name: "Accessibility" } } });
    render(<Harness />);
    await user.type(screen.getByLabelText("Add a skill"), "Accessibility{Enter}");
    expect(addSkill).toHaveBeenCalledWith({ name: "Accessibility" });
    expect(await screen.findByText("Accessibility")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a skill")).toHaveValue("");
    // No roles use it yet, so no count.
    expect(within(screen.getByRole("list", { name: "Your skills" })).getAllByRole("listitem")[2]).not.toHaveTextContent(/role/);
  });

  it("ignores a skill that's already there, in any case", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Add a skill"), "figma{Enter}");
    expect(addSkill).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("“Figma” is already in your skills.");
    expect(within(screen.getByRole("list", { name: "Your skills" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("removes a skill from the profile and from every role", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Remove Figma" }));
    expect(removeSkill).toHaveBeenCalledWith({ id: "s1" });
    expect(screen.queryByText("Figma")).not.toBeInTheDocument();
    expect(latest.experience.map((entry) => entry.skillIds)).toEqual([["s2"], []]);
  });

  it("puts a failed removal back", async () => {
    const user = userEvent.setup();
    vi.mocked(removeSkill).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Remove Figma" }));
    await waitFor(() => expect(screen.getByText("Figma")).toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith("Something went wrong on the server. Please try again.");
  });
});

describe("Languages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setLanguageLevel).mockResolvedValue({ ok: true, data: null });
    vi.mocked(removeLanguage).mockResolvedValue({ ok: true, data: null });
  });

  it("lists languages with their own level select", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText("1 added")).toBeInTheDocument();
    const level = screen.getByLabelText("Dutch level");
    expect(level).toHaveValue("NATIVE");
    await user.selectOptions(level, "Fluent (C2)");
    expect(setLanguageLevel).toHaveBeenCalledWith({ id: "l1", level: "C2" });
    expect(latest.languages[0].level).toBe("C2");
  });

  it("adds a language at the chosen level, Intermediate (B1) by default", async () => {
    const user = userEvent.setup();
    vi.mocked(addLanguage).mockResolvedValue({ ok: true, data: { added: true, language: { id: "l2", name: "French", level: "B1" } } });
    render(<Harness />);
    expect(screen.getByLabelText("Level")).toHaveValue("B1");
    await user.type(screen.getByLabelText("Language"), "French{Enter}");
    expect(addLanguage).toHaveBeenCalledWith({ name: "French", level: "B1" });
    expect(await screen.findByLabelText("French level")).toHaveValue("B1");
  });

  it("updates the level instead of adding a language twice", async () => {
    const user = userEvent.setup();
    vi.mocked(addLanguage).mockResolvedValue({ ok: true, data: { added: false, language: { id: "l1", name: "Dutch", level: "C1" } } });
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Level"), "Advanced (C1)");
    await user.type(screen.getByLabelText("Language"), "dutch");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(toast).toHaveBeenCalledWith("Updated Dutch to Advanced (C1).");
    await waitFor(() => expect(latest.languages).toEqual([{ id: "l1", name: "Dutch", level: "C1" }]));
  });

  it("removes a language", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Remove Dutch" }));
    expect(removeLanguage).toHaveBeenCalledWith({ id: "l1" });
    expect(screen.queryByLabelText("Dutch level")).not.toBeInTheDocument();
  });
});
