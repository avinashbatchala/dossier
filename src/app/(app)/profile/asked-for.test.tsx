import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { countDemand, type Demand } from "@/lib/demand-count";
import type { ExperienceItem, ProfileData } from "@/lib/profile";

import { addAskedSkill, hideAskedSkill, notHereAskedSkill } from "./actions";
import { askers, AskedForCard, GapPrompt, useAskedFor } from "./asked-for";

vi.mock("./actions", () => ({
  addAskedSkill: vi.fn(),
  hideAskedSkill: vi.fn(async () => ({ ok: true, data: null })),
  notHereAskedSkill: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: <T,>(result: T) => result }));

const role: ExperienceItem = {
  id: "e1", role: "Senior Product Designer", company: "Northwind Logistics", location: "", descriptor: "", volunteering: false,
  bullets: "Led the redesign", startYear: 2021, startMonth: 3, endYear: null, endMonth: null, current: true, skillIds: [],
};
const empty: ProfileData = {
  basics: {} as ProfileData["basics"], skills: [{ id: "s1", name: "Figma", group: "" }], languages: [], experience: [role], projects: [], education: [],
  certifications: [], publications: [], references: [], customSections: [], facts: [], photo: null,
};
const posting = (company: string, ...skills: string[]) => ({ company, asks: skills.map((skill) => ({ skill, covered: false })) });
const many = countDemand([
  posting("Ledgerly", "Kubernetes", "Figma", "Payments"),
  posting("Adyen", "Kubernetes", "Figma", "Payments"),
  posting("Finch Ledger", "Kubernetes", "Figma"),
  posting("Mollie", "Kubernetes", "React"),
  posting("Bunq", "Go"),
]);

let latest: ProfileData;
function Harness({ demand, hidden = [] }: { demand: Demand; hidden?: string[] }) {
  const [profile, setProfile] = useState(empty);
  useEffect(() => {
    latest = profile;
  });
  const state = useAskedFor({ profileId: "p1", demand, hidden, notHere: [], profile, update: setProfile });
  return <AskedForCard state={state} profile={profile} profileName="" />;
}

beforeEach(() => vi.clearAllMocks());

describe("AskedForCard (E33-3)", () => {
  it("says what it waits for until there are enough postings, and nothing else", () => {
    render(<Harness demand={countDemand([posting("Ledgerly", "Kubernetes")])} />);
    expect(screen.getByRole("region", { name: "What employers ask for" })).toHaveTextContent("Shows once 5 postings you saved or applied for are scored for this profile. 1 so far.");
    expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  });

  it("lists the three most asked gaps with who asks, leaving out what the profile lists and what was marked as not had", () => {
    render(<Harness demand={many} hidden={["go"]} />);
    const card = screen.getByRole("region", { name: "Asked for, not in your profile" });
    const rows = within(card).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "KubernetesIn 4 postings · Ledgerly, Adyen, Finch Ledger…Add Kubernetes",
      "PaymentsIn 2 postings · Ledgerly, AdyenAdd Payments",
      "ReactIn 1 posting · MollieAdd React",
    ]);
  });

  it("adds a gap where it was used, and it's covered at once", async () => {
    const user = userEvent.setup();
    vi.mocked(addAskedSkill).mockResolvedValue({ ok: true, data: { skill: { id: "s2", name: "Kubernetes", group: "" }, experienceId: "e1", bullets: "Led the redesign\nRan the clusters" } });
    render(<Harness demand={many} />);
    await user.click(screen.getByRole("button", { name: "Add Kubernetes" }));
    const form = screen.getByRole("group", { name: "Add Kubernetes to your profile" });
    expect(within(form).getByLabelText("Where you used it")).toHaveValue("e1");
    await user.type(within(form).getByLabelText(/What you did with it/), "Ran the clusters");
    await user.click(within(form).getByRole("button", { name: "Add to profile" }));
    expect(addAskedSkill).toHaveBeenCalledWith({ profileId: "p1", name: "Kubernetes", experienceId: "e1", did: "Ran the clusters" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add Kubernetes" })).not.toBeInTheDocument());
    expect(latest.skills.map((skill) => skill.name)).toEqual(["Figma", "Kubernetes"]);
    expect(latest.experience[0]).toMatchObject({ skillIds: ["s2"], bullets: "Led the redesign\nRan the clusters" });
    expect(toast).toHaveBeenCalledWith("Added “Kubernetes” to your profile, at Northwind Logistics.");
  });

  it("hides a gap marked “I don't have this”, with Undo", async () => {
    const user = userEvent.setup();
    render(<Harness demand={many} />);
    await user.click(screen.getByRole("button", { name: "Add Payments" }));
    await user.click(screen.getByRole("button", { name: "I don't have this" }));
    expect(screen.queryByRole("button", { name: "Add Payments" })).not.toBeInTheDocument();
    expect(hideAskedSkill).toHaveBeenCalledWith({ profileId: "p1", key: "payments", hidden: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Noted. It won't come up here again for this profile.", expect.anything()));
    vi.mocked(toast).mock.calls[0][1]!.action!.onClick();
    expect(await screen.findByRole("button", { name: "Add Payments" })).toBeInTheDocument();
    expect(hideAskedSkill).toHaveBeenLastCalledWith({ profileId: "p1", key: "payments", hidden: false });
  });

  it("opens the sheet with the eight most asked, how often each comes up and whether the profile covers it", async () => {
    const user = userEvent.setup();
    render(<Harness demand={many} />);
    await user.click(screen.getByRole("button", { name: /Asked for, not in your profile/ }));
    const sheet = screen.getByRole("dialog", { name: "What employers ask for" });
    expect(sheet).toHaveAccessibleDescription("From 5 postings you saved or applied for. The bar is how often it comes up. ✓ means your profile covers it.");
    expect(within(sheet).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "–Kubernetes, not in your profile4 of 5Add Kubernetes",
      "✓Figma, in your profile3 of 5",
      "–Payments, not in your profile2 of 5Add Payments",
      "–Go, not in your profile1 of 5Add Go",
      "–React, not in your profile1 of 5Add React",
    ]);
  });
});

function PromptHarness({ demand, notHere = [] }: { demand: Demand; notHere?: string[] }) {
  const [profile, setProfile] = useState(empty);
  useEffect(() => {
    latest = profile;
  });
  const state = useAskedFor({ profileId: "p1", demand, hidden: [], notHere, profile, update: setProfile });
  const ask = state.promptFor("e1");
  return ask ? <GapPrompt key={ask.key} role={profile.experience[0]} ask={ask} state={state} /> : <p>No prompt</p>;
}

describe("GapPrompt (E33-4)", () => {
  it("names who asks", () => {
    expect(askers({ count: 1, companies: ["Ledgerly"] })).toBe("Ledgerly");
    expect(askers({ count: 3, companies: ["Ledgerly", "Adyen", "Finch Ledger"] })).toBe("Ledgerly, Adyen and Finch Ledger");
    expect(askers({ count: 5, companies: ["Ledgerly", "Adyen", "Finch Ledger", "Mollie"] })).toBe("Ledgerly, Adyen and 2 others");
    expect(askers({ count: 2, companies: [] })).toBe("2 postings");
  });

  it("asks the role about the top gap from a template, and nothing until there are enough postings", () => {
    const { unmount } = render(<PromptHarness demand={countDemand([posting("Ledgerly", "Kubernetes")])} />);
    expect(screen.getByText("No prompt")).toBeInTheDocument();
    unmount();
    render(<PromptHarness demand={many} />);
    expect(screen.getByRole("group", { name: "A question about Kubernetes" })).toHaveTextContent(
      "Ledgerly, Adyen and 2 others ask about Kubernetes. Did anything at Northwind Logistics touch it? Only add it if it's true.",
    );
  });

  it("adds a line to the role, with the skill, and then asks about the next gap", async () => {
    const user = userEvent.setup();
    vi.mocked(addAskedSkill).mockResolvedValue({ ok: true, data: { skill: { id: "s2", name: "Kubernetes", group: "" }, experienceId: "e1", bullets: "Led the redesign\nRan the clusters" } });
    render(<PromptHarness demand={many} />);
    await user.click(screen.getByRole("button", { name: "Add a line" }));
    await user.type(screen.getByLabelText("What you did with Kubernetes at Northwind Logistics"), "Ran the clusters{Enter}");
    expect(addAskedSkill).toHaveBeenCalledWith({ profileId: "p1", name: "Kubernetes", experienceId: "e1", did: "Ran the clusters" });
    expect(await screen.findByRole("group", { name: "A question about Payments" })).toBeInTheDocument();
    expect(latest.experience[0].bullets).toBe("Led the redesign\nRan the clusters");
  });

  it("keeps Not here for the role, with Undo, and skips gaps already marked", async () => {
    const user = userEvent.setup();
    render(<PromptHarness demand={many} notHere={["e1 kubernetes"]} />);
    expect(screen.getByRole("group", { name: "A question about Payments" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Not here" }));
    expect(notHereAskedSkill).toHaveBeenCalledWith({ profileId: "p1", roleId: "e1", key: "payments", on: true });
    expect(screen.getByRole("group", { name: "A question about Go" })).toBeInTheDocument();
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Noted. It won't be asked about this role again.", expect.anything()));
    vi.mocked(toast).mock.calls[0][1]!.action!.onClick();
    expect(await screen.findByRole("group", { name: "A question about Payments" })).toBeInTheDocument();
    expect(notHereAskedSkill).toHaveBeenLastCalledWith({ profileId: "p1", roleId: "e1", key: "payments", on: false });
  });
});
