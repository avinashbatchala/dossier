import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { EntryOrder, ExperienceItem, ProfileData } from "@/lib/profile";
import type { RoleUsage } from "@/lib/role-usage-count";

import {
  attachNewSkill,
  createExperience,
  removeExperience,
  reorderEntries,
  restoreExperience,
  saveExperience,
  setExperienceSkill,
  setRoleVolunteering,
  sortEntriesByDate,
} from "./actions";
import { ExperienceSection } from "./experience-section";
import { parseYear } from "./month-year-field";

vi.mock("./actions", () => ({
  attachNewSkill: vi.fn(),
  setExperienceSkill: vi.fn(async () => ({ ok: true, data: null })),
  setRoleVolunteering: vi.fn(async () => ({ ok: true, data: null })),
  createExperience: vi.fn(),
  saveExperience: vi.fn(async () => ({ ok: true, data: null })),
  removeExperience: vi.fn(async () => ({ ok: true, data: null })),
  restoreExperience: vi.fn(),
  reorderEntries: vi.fn(async () => ({ ok: true, data: null })),
  sortEntriesByDate: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: <T,>(result: T) => result }));

const northwind: ExperienceItem = {
  id: "e1",
  role: "Senior Product Designer",
  company: "Northwind Logistics",
  location: "Rotterdam",
  descriptor: "",
  volunteering: false,
  bullets: "Led the redesign",
  startYear: 2021,
  startMonth: 3,
  endYear: null,
  endMonth: null,
  current: true,
  skillIds: ["s1"],
};
const fieldnote: ExperienceItem = { ...northwind, id: "e2", role: "Product Designer", company: "Fieldnote", current: false, startYear: 2018, startMonth: 6, endYear: 2021, endMonth: 2, skillIds: [] };

let latest: ProfileData;
const noUsage: RoleUsage = { resumes: 0, roles: {} };
function Harness({
  order = "date",
  volunteering = false,
  usage = noUsage,
  roles = [northwind, fieldnote],
}: {
  order?: EntryOrder;
  volunteering?: boolean;
  usage?: RoleUsage;
  roles?: ExperienceItem[];
}) {
  const [state, setState] = useState<ProfileData>({
    basics: {} as ProfileData["basics"],
    skills: [
      { id: "s1", name: "Design systems", group: "" },
      { id: "s2", name: "Figma", group: "" },
    ],
    languages: [],
    experience: roles,
    projects: [],
    education: [],
    certifications: [],
    publications: [],
    references: [],
    customSections: [],
    facts: [],
    photo: null,
  });
  useEffect(() => {
    latest = state;
  });
  return <ExperienceSection key={String(volunteering)} order={order} profile={state} update={(change) => setState(change)} usage={usage} volunteering={volunteering} />;
}

const header = (name: RegExp | string) => screen.getByRole("button", { name, expanded: false });

describe("ExperienceSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarises closed cards: role, company · location, dates and skills", () => {
    render(<Harness />);
    const card = screen.getByRole("button", { name: /Senior Product Designer/, expanded: false });
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(card).toHaveTextContent("Northwind Logistics · Rotterdam");
    expect(card).toHaveTextContent("Mar 2021 – Present");
    expect(card).toHaveTextContent("Design systems");
    expect(screen.getByRole("button", { name: /Product Designer.*Fieldnote/ })).toHaveTextContent("Jun 2018 – Feb 2021");
  });

  it("opens one card at a time", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/Senior Product Designer/));
    expect(screen.getByLabelText("Role")).toHaveValue("Senior Product Designer");
    expect(screen.getByLabelText("Started month")).toHaveValue("3");
    expect(screen.getByLabelText("Started year")).toHaveValue("2021");
    expect(screen.getByLabelText("I still work here")).toBeChecked();
    expect(screen.getByLabelText("Ended year")).toBeDisabled();

    await user.click(header(/Product Designer.*Fieldnote/));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
    expect(screen.getByLabelText("Role")).toHaveValue("Product Designer");
  });

  it("autosaves edits and keeps a half-typed year out of the saved date", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/Product Designer.*Fieldnote/));
    const year = screen.getByLabelText("Started year");
    await user.clear(year);
    await user.type(year, "201");
    await waitFor(() => expect(saveExperience).toHaveBeenLastCalledWith(expect.objectContaining({ id: "e2", startYear: null })), { timeout: 2000 });
    await user.type(year, "7");
    await waitFor(() => expect(saveExperience).toHaveBeenLastCalledWith(expect.objectContaining({ id: "e2", startYear: 2017, startMonth: 6 })), { timeout: 2000 });
  });

  it("moves a role to Volunteering, where it's listed and named for it (#294)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(header(/Product Designer.*Fieldnote/));
    expect(screen.getByRole("textbox", { name: "Company" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move to Volunteering" }));
    expect(setRoleVolunteering).toHaveBeenCalledWith({ id: "e2", volunteering: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Product Designer.*Fieldnote/ })).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith("Moved “Product Designer” to Volunteering.");
    expect(latest.experience.find((entry) => entry.id === "e2")?.volunteering).toBe(true);

    rerender(<Harness volunteering />);
    await user.click(header(/Product Designer.*Fieldnote/));
    expect(screen.getByRole("textbox", { name: "Organisation" })).toHaveValue("Fieldnote");
    expect(screen.getByRole("checkbox", { name: "I still volunteer here" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Northwind/ })).not.toBeInTheDocument();
  });

  it("adds a role to the list it's on, and keeps the other list's roles when saving an order", async () => {
    const user = userEvent.setup();
    vi.mocked(createExperience).mockResolvedValue({ ok: true, data: { ...northwind, id: "e3", role: "", company: "", volunteering: true, skillIds: [] } });
    render(<Harness volunteering />);
    await user.click(screen.getByRole("button", { name: "+ Add volunteering" }));
    expect(createExperience).toHaveBeenCalledWith({ profileId: "", volunteering: true });
    expect(latest.experience.map((entry) => entry.id)).toContain("e1");

    vi.mocked(createExperience).mockResolvedValue({ ok: true, data: { ...northwind, id: "e4", role: "Treasurer", company: "", volunteering: true, skillIds: [] } });
    await user.click(screen.getByRole("button", { name: "+ Add volunteering" }));
    await user.click(screen.getByRole("button", { name: "Move “Treasurer” up" }));
    expect(reorderEntries).toHaveBeenLastCalledWith({ profileId: "", section: "experience", ids: ["e4", "e3", "e1", "e2"] });
  });

  it("adds a blank role and opens it with the cursor in Role", async () => {
    const user = userEvent.setup();
    vi.mocked(createExperience).mockResolvedValue({ ok: true, data: { ...northwind, id: "e3", role: "", company: "", location: "", bullets: "", startYear: null, startMonth: null, current: false, skillIds: [] } });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "+ Add a role" }));
    expect(await screen.findByRole("button", { name: /New role/, expanded: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveFocus();
  });

  it("removes a role at once and puts it back from the toast's Undo", async () => {
    const user = userEvent.setup();
    vi.mocked(restoreExperience).mockResolvedValue({ ok: true, data: northwind });
    render(<Harness />);
    await user.click(header(/Senior Product Designer/));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(removeExperience).toHaveBeenCalledWith({ id: "e1" });
    expect(latest.experience.map((entry) => entry.id)).toEqual(["e2"]);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Removed “Senior Product Designer”.", expect.anything()));

    const { action } = vi.mocked(toast).mock.calls.at(-1)![1]!;
    await act(async () => action!.onClick());
    expect(restoreExperience).toHaveBeenCalledWith({ ...northwind, profileId: "" });
    expect(latest.experience.map((entry) => entry.id)).toEqual(["e1", "e2"]);
  });

  it("shows the empty state", () => {
    function Empty() {
      const [state, setState] = useState<ProfileData>({ basics: {} as ProfileData["basics"], skills: [], languages: [], experience: [], projects: [], education: [], certifications: [], publications: [], references: [], customSections: [], facts: [], photo: null });
      return <ExperienceSection order="date" profile={state} update={(change) => setState(change)} usage={noUsage} />;
    }
    render(<Empty />);
    expect(screen.getByText("Nothing here yet. Add your first one below.")).toBeInTheDocument();
  });
});

describe("year field", () => {
  it("only counts four-digit plausible years", () => {
    expect(parseYear("2021")).toBe(2021);
    expect(parseYear(" 2021 ")).toBe(2021);
    expect(parseYear("202")).toBeNull();
    expect(parseYear("21")).toBeNull();
    expect(parseYear("1850")).toBeNull();
    expect(parseYear("abcd")).toBeNull();
  });

  it("asks for a four-digit year once you leave a half-typed one", async () => {
    render(<Harness />);
    fireEvent.click(header(/Product Designer.*Fieldnote/));
    const year = screen.getByLabelText("Started year");
    fireEvent.change(year, { target: { value: "20" } });
    expect(year).not.toHaveAccessibleDescription();
    fireEvent.blur(year);
    expect(year).toHaveAccessibleDescription("Enter a four-digit year, like 2021.");
    expect(year).toBeInvalid();
  });
});

describe("skills used in a role", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows every profile skill as a toggle, with how many are attached", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/Senior Product Designer/));
    const group = screen.getByRole("group", { name: "Skills you used here" });
    expect(group).toHaveTextContent("1 of 2 attached");
    expect(screen.getByRole("button", { name: "Design systems", pressed: true })).toHaveTextContent("✓ Design systems");
    expect(screen.getByRole("button", { name: "Figma", pressed: false })).toBeInTheDocument();
  });

  it("attaches and detaches a skill right away, without autosaving the role", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/Senior Product Designer/));
    await user.click(screen.getByRole("button", { name: "Figma" }));
    expect(setExperienceSkill).toHaveBeenCalledWith({ experienceId: "e1", skillId: "s2", attached: true });
    expect(latest.experience[0].skillIds).toEqual(["s1", "s2"]);
    expect(screen.getByRole("group", { name: "Skills you used here" })).toHaveTextContent("2 of 2 attached");

    await user.click(screen.getByRole("button", { name: "Design systems" }));
    expect(setExperienceSkill).toHaveBeenLastCalledWith({ experienceId: "e1", skillId: "s1", attached: false });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(saveExperience).not.toHaveBeenCalled();
  });

  it("adds a new skill to the profile and attaches it in one step", async () => {
    const user = userEvent.setup();
    vi.mocked(attachNewSkill).mockResolvedValue({ ok: true, data: { added: true, skill: { id: "s3", name: "Accessibility", group: "" } } });
    render(<Harness />);
    await user.click(header(/Senior Product Designer/));
    await user.type(screen.getByLabelText("Add a new skill to this role"), "Accessibility{Enter}");
    expect(attachNewSkill).toHaveBeenCalledWith({ experienceId: "e1", name: "Accessibility" });
    await waitFor(() => expect(latest.skills.map((skill) => skill.name)).toContain("Accessibility"));
    expect(latest.experience[0].skillIds).toEqual(["s1", "s3"]);
  });

  it("attaches an existing skill when its name is typed in another case", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/Senior Product Designer/));
    await user.type(screen.getByLabelText("Add a new skill to this role"), "figma{Enter}");
    expect(attachNewSkill).not.toHaveBeenCalled();
    expect(setExperienceSkill).toHaveBeenCalledWith({ experienceId: "e1", skillId: "s2", attached: true });
  });
});

describe("reordering roles (E4-9)", () => {
  const titles = () => latest.experience.map((entry) => entry.role);

  it("moves a role with its arrows, saves the order and says so", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText(/^Newest first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move “Senior Product Designer” up" })).toHaveAttribute("aria-disabled", "true");

    const down = screen.getByRole("button", { name: "Move “Senior Product Designer” down" });
    await user.click(down);
    expect(titles()).toEqual(["Product Designer", "Senior Product Designer"]);
    expect(reorderEntries).toHaveBeenLastCalledWith({ profileId: "", section: "experience", ids: ["e2", "e1"] });
    expect(screen.getByText("“Senior Product Designer” moved to position 2 of 2.")).toHaveAttribute("role", "status");
    expect(screen.getByText("In your own order.")).toBeInTheDocument();
    // Focus stays on the button, now at the end and marked unavailable.
    expect(down).toHaveFocus();
    expect(down).toHaveAttribute("aria-disabled", "true");
  });

  it("goes back to date order", async () => {
    const user = userEvent.setup();
    vi.mocked(sortEntriesByDate).mockResolvedValueOnce({ ok: true, data: ["e1", "e2"] });
    render(<Harness order="manual" />);
    await user.click(screen.getByRole("button", { name: "Move “Senior Product Designer” down" }));
    await user.click(screen.getByRole("button", { name: "Sort by date" }));
    expect(sortEntriesByDate).toHaveBeenCalledWith({ profileId: "", section: "experience" });
    expect(titles()).toEqual(["Senior Product Designer", "Product Designer"]);
    expect(screen.getByText(/^Newest first/)).toBeInTheDocument();
  });

  it("puts a new role first in an order set by hand", async () => {
    const user = userEvent.setup();
    vi.mocked(createExperience).mockResolvedValueOnce({ ok: true, data: { ...fieldnote, id: "e3", role: "", company: "", startYear: null } });
    render(<Harness order="manual" />);
    await user.click(screen.getByRole("button", { name: "+ Add a role" }));
    expect(latest.experience.map((entry) => entry.id)).toEqual(["e3", "e1", "e2"]);
  });

  it("puts things back when the order can't be saved", async () => {
    const user = userEvent.setup();
    vi.mocked(reorderEntries).mockResolvedValueOnce({ ok: false, error: "The list changed in the meantime. Reload the page and try again." });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Move “Product Designer” up" }));
    expect(titles()).toEqual(["Senior Product Designer", "Product Designer"]);
    expect(toast).toHaveBeenCalledWith("The list changed in the meantime. Reload the page and try again.");
  });
});


describe("ExperienceSection's usage and empty roles (E33-2)", () => {
  it("says how many resumes use each role: on the closed card with its lines, and on the open one's header", async () => {
    const user = userEvent.setup();
    render(<Harness usage={{ resumes: 7, roles: { e1: 6 } }} />);
    expect(header(/^Senior Product Designer/)).toHaveTextContent("1 line · used in 6 resumes");
    expect(header(/^Product Designer/)).toHaveTextContent("1 line · not used in a resume yet");
    await user.click(header(/^Senior Product Designer/));
    expect(screen.getByRole("button", { name: /^Senior Product Designer/, expanded: true })).toHaveTextContent("Used in 6 of 7 resumes");
  });

  it("leaves the usage out before the first tailored resume", () => {
    render(<Harness />);
    expect(header(/^Senior Product Designer/)).toHaveTextContent("1 line");
    expect(header(/^Senior Product Designer/)).not.toHaveTextContent("resume");
  });

  it("warns on a paid role with no lines, but not on volunteering", () => {
    const bare = { ...fieldnote, bullets: " " };
    const { unmount } = render(<Harness roles={[northwind, bare]} />);
    const card = header(/^Product Designer/);
    expect(card).toHaveTextContent("No lines yet: add one or two so the AI has something to work with");
    expect(card.closest(".border-warning-line")).not.toBeNull();
    expect(header(/^Senior Product Designer/).closest(".border-warning-line")).toBeNull();
    unmount();
    render(<Harness volunteering roles={[{ ...bare, volunteering: true }]} />);
    expect(header(/^Product Designer/)).not.toHaveTextContent("No lines yet");
  });
});
