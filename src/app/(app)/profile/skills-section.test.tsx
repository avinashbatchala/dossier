import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { ProfileData } from "@/lib/profile";

import { addLanguage, addSkill, removeLanguage, removeSkill, renameSkillGroup, setLanguageLevel, setSkillGroup } from "./actions";
import { SkillsSection } from "./skills-section";

vi.mock("./actions", () => ({
  addSkill: vi.fn(),
  removeSkill: vi.fn(),
  setSkillGroup: vi.fn(),
  renameSkillGroup: vi.fn(),
  addLanguage: vi.fn(),
  setLanguageLevel: vi.fn(),
  removeLanguage: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const span = { startYear: null, startMonth: null, endYear: null, endMonth: null, current: false };
const profile = (): ProfileData => ({
  basics: {} as ProfileData["basics"],
  skills: [
    { id: "s1", name: "Figma", group: "" },
    { id: "s2", name: "User research", group: "" },
  ],
  languages: [{ id: "l1", name: "Dutch", level: "NATIVE" }],
  experience: [
    { id: "e1", role: "A", company: "", location: "", descriptor: "", bullets: "", skillIds: ["s1", "s2"], ...span },
    { id: "e2", role: "B", company: "", location: "", descriptor: "", bullets: "", skillIds: ["s1"], ...span },
  ],
  projects: [],
  education: [],
  publications: [],
  references: [],
  facts: [],
  photo: null,
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
    vi.mocked(addSkill).mockResolvedValue({ ok: true, data: { added: true, skill: { id: "s3", name: "Accessibility", group: "" } } });
    render(<Harness />);
    await user.type(screen.getByLabelText("Add a skill"), "Accessibility{Enter}");
    expect(addSkill).toHaveBeenCalledWith({ name: "Accessibility", group: "" });
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

describe("Skill groups (#280)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(addSkill).mockImplementation(async ({ name, group = "" }) => ({ ok: true, data: { added: true, skill: { id: `new-${name}`, name, group } } }));
    vi.mocked(setSkillGroup).mockResolvedValue({ ok: true, data: null });
    vi.mocked(renameSkillGroup).mockResolvedValue({ ok: true, data: null });
  });

  const newGroup = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole("button", { name: "+ New group" }));
    await user.type(screen.getByLabelText("Name of the new group"), `${name}{Enter}`);
  };

  it("makes a group, which is saved with its first skill, in a field of its own", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await newGroup(user, "Tools");
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Add to Tools"), "Ahrefs{Enter}");
    expect(addSkill).toHaveBeenCalledWith({ name: "Ahrefs", group: "Tools" });
    expect(within(await screen.findByRole("list", { name: "Skills in Tools" })).getByText("Ahrefs")).toBeInTheDocument();
    expect(latest.skills.at(-1)).toEqual({ id: "new-Ahrefs", name: "Ahrefs", group: "Tools" });
  });

  it("refuses a group name with “:” or “·”, or one that's taken", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await newGroup(user, "Tools: design");
    expect(toast).toHaveBeenCalledWith("A group's name can't have “:” or “·” in it.");
    await user.clear(screen.getByLabelText("Name of the new group"));
    await user.type(screen.getByLabelText("Name of the new group"), "Tools{Enter}");
    await newGroup(user, "tools");
    expect(toast).toHaveBeenLastCalledWith("There's a group called tools already.");
  });

  it("moves a skill from its menu, and moves one typed into another group's field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await newGroup(user, "Design");
    await user.type(screen.getByLabelText("Add to Design"), "Prototyping{Enter}");
    await user.click(screen.getByRole("button", { name: "Figma (change its group)" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Design" }));
    expect(setSkillGroup).toHaveBeenCalledWith({ id: "s1", group: "Design" });
    expect(within(screen.getByRole("list", { name: "Skills in Design" })).getByText("Figma")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Add a skill"), "figma{Enter}");
    expect(setSkillGroup).toHaveBeenLastCalledWith({ id: "s1", group: "" });
    expect(toast).toHaveBeenCalledWith("Moved “Figma” out of Design.");
    expect(within(screen.getByRole("list", { name: "Your skills" })).getByText("Figma")).toBeInTheDocument();
  });

  it("renames a group, moving its skills with it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await newGroup(user, "Desing");
    await user.type(screen.getByLabelText("Add to Desing"), "Prototyping{Enter}");
    await user.click(screen.getByRole("button", { name: "Rename Desing" }));
    await user.clear(screen.getByLabelText("New name for Desing"));
    await user.type(screen.getByLabelText("New name for Desing"), "Design{Enter}");
    expect(renameSkillGroup).toHaveBeenCalledWith({ from: "Desing", to: "Design" });
    expect(screen.getByRole("heading", { name: "Design" })).toBeInTheDocument();
    expect(latest.skills.find((skill) => skill.name === "Prototyping")?.group).toBe("Design");
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
