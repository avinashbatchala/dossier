import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { ProfileData, ProjectItem } from "@/lib/profile";

import { attachNewProjectSkill, createProject, removeProject, reorderEntries, restoreProject, saveProject, setProjectSkill } from "./actions";
import { ProjectsSection } from "./projects-section";

vi.mock("./actions", () => ({
  attachNewProjectSkill: vi.fn(),
  setProjectSkill: vi.fn(async () => ({ ok: true, data: null })),
  createProject: vi.fn(),
  saveProject: vi.fn(async () => ({ ok: true, data: null })),
  removeProject: vi.fn(async () => ({ ok: true, data: null })),
  restoreProject: vi.fn(),
  reorderEntries: vi.fn(async () => ({ ok: true, data: null })),
  sortEntriesByDate: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const churn: ProjectItem = {
  id: "p1",
  name: "Churn predictor",
  link: "github.com/jane/churn",
  bullets: "Trained a gradient-boosted model on 2 years of usage data",
  startYear: 2025,
  startMonth: 2,
  endYear: null,
  endMonth: null,
  current: true,
  skillIds: ["s1"],
};
const thesis: ProjectItem = { ...churn, id: "p2", name: "Thesis: fair ranking", link: "", current: false, startYear: 2023, startMonth: 9, endYear: 2024, endMonth: 6, skillIds: [] };

let latest: ProfileData;
function Harness() {
  const [state, setState] = useState<ProfileData>({
    basics: {} as ProfileData["basics"],
    skills: [
      { id: "s1", name: "Python" },
      { id: "s2", name: "SQL" },
    ],
    languages: [],
    experience: [],
    projects: [churn, thesis],
    education: [],
    references: [],
  });
  useEffect(() => {
    latest = state;
  });
  return <ProjectsSection order="date" profile={state} update={(change) => setState(change)} />;
}

const header = (name: RegExp | string) => screen.getByRole("button", { name, expanded: false });

describe("ProjectsSection (PRO-13)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarises closed cards: name, link, dates and skills", () => {
    render(<Harness />);
    const card = header(/Churn predictor/);
    expect(card).toHaveTextContent("github.com/jane/churn");
    expect(card).toHaveTextContent("Feb 2025 – Present");
    expect(card).toHaveTextContent("Python");
    expect(header(/Thesis: fair ranking/)).toHaveTextContent("Sep 2023 – Jun 2024");
  });

  it("opens a project's fields and autosaves edits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/Thesis: fair ranking/));
    expect(screen.getByLabelText("Project")).toHaveValue("Thesis: fair ranking");
    expect(screen.getByLabelText("Still working on it")).not.toBeChecked();
    await user.type(screen.getByLabelText("Link"), "arxiv.org/abs/2406.0001");
    await user.type(screen.getByLabelText("What you did"), "{Enter}Wrote it up");
    await waitFor(
      () =>
        expect(saveProject).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: "p2", link: "arxiv.org/abs/2406.0001", bullets: `${thesis.bullets}\nWrote it up` }),
        ),
      { timeout: 2000 },
    );
    expect(saveProject).not.toHaveBeenCalledWith(expect.objectContaining({ skillIds: expect.anything() }));
  });

  it("adds a blank project and opens it with the cursor in Project", async () => {
    const user = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({ ok: true, data: { ...churn, id: "p3", name: "", link: "", bullets: "", startYear: null, startMonth: null, current: false, skillIds: [] } });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "+ Add a project" }));
    expect(await screen.findByRole("button", { name: /New project/, expanded: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toHaveFocus();
  });

  it("attaches skills, and adds a new one to the profile in one step", async () => {
    const user = userEvent.setup();
    vi.mocked(attachNewProjectSkill).mockResolvedValue({ ok: true, data: { added: true, skill: { id: "s3", name: "pandas" } } });
    render(<Harness />);
    await user.click(header(/Churn predictor/));
    expect(screen.getByRole("group", { name: "Skills you used here" })).toHaveTextContent("1 of 2 attached");
    await user.click(screen.getByRole("button", { name: "SQL" }));
    expect(setProjectSkill).toHaveBeenCalledWith({ projectId: "p1", skillId: "s2", attached: true });
    expect(latest.projects[0].skillIds).toEqual(["s1", "s2"]);

    await user.type(screen.getByLabelText("Add a new skill to this project"), "pandas{Enter}");
    expect(attachNewProjectSkill).toHaveBeenCalledWith({ projectId: "p1", name: "pandas" });
    await waitFor(() => expect(latest.skills.map((skill) => skill.name)).toContain("pandas"));
    expect(latest.projects[0].skillIds).toEqual(["s1", "s2", "s3"]);
  });

  it("removes a project at once and puts it back from the toast's Undo", async () => {
    const user = userEvent.setup();
    vi.mocked(restoreProject).mockResolvedValue({ ok: true, data: churn });
    render(<Harness />);
    await user.click(header(/Churn predictor/));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(removeProject).toHaveBeenCalledWith({ id: "p1" });
    expect(latest.projects.map((entry) => entry.id)).toEqual(["p2"]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Removed “Churn predictor”.", expect.anything()));
    const { action } = vi.mocked(toast).mock.calls.at(-1)![1]!;
    await act(async () => action!.onClick());
    expect(restoreProject).toHaveBeenCalledWith(churn);
    expect(latest.projects.map((entry) => entry.id)).toEqual(["p1", "p2"]);
  });

  it("moves a project with its arrows and saves the order for projects", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getAllByRole("button", { name: /Move .* down/ })[0]);
    await waitFor(() => expect(reorderEntries).toHaveBeenCalledWith({ section: "project", ids: ["p2", "p1"] }));
  });
});
