import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { saveAgentSettings } from "../agent/actions";
import { AgentSection, type AgentSettings } from "./agent-section";

vi.mock("../agent/actions", () => ({ saveAgentSettings: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));

const initial: AgentSettings = {
  enabled: false,
  query: { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" },
  hour: 7,
  minScore: 70,
  maxScores: 15,
  maxDrafts: 3,
  autoDraft: false,
};
const countries = [
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
];
const open = (props: Partial<Parameters<typeof AgentSection>[0]> = {}) =>
  render(<AgentSection initial={initial} source="JSEARCH" aiReady countries={countries} timeZone="Europe/Berlin" {...props} />);

beforeEach(() => vi.clearAllMocks());

describe("Settings → Job agent (E16-7)", () => {
  it("is off until it's turned on, and turns on with the search, saved with it", async () => {
    const user = userEvent.setup();
    open();
    const toggle = screen.getByRole("switch", { name: "Run the job agent" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Off. Nothing is searched or scored until it's on.");
    await user.click(toggle);
    expect(saveAgentSettings).toHaveBeenCalledWith({ enabled: true, query: initial.query });
    expect(toggle).toHaveAccessibleDescription(/^On\. It runs once a day after 07:00 your time \(Europe\/Berlin\)/);
  });

  it("needs keywords and a country to turn on", async () => {
    const user = userEvent.setup();
    open({ initial: { ...initial, query: { ...initial.query, keywords: "", country: "" } } });
    await user.click(screen.getByRole("switch", { name: "Run the job agent" }));
    expect(saveAgentSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText("What")).toHaveAccessibleDescription("Type what the agent should look for.");
    expect(screen.getByLabelText("Country")).toHaveAccessibleDescription("Choose a country.");
    expect(screen.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "false");
  });

  it("saves the search once typing pauses, and the other choices at once", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("What"), " NLP");
    await waitFor(() => expect(saveAgentSettings).toHaveBeenLastCalledWith({ query: { ...initial.query, keywords: "Data scientist NLP" } }), { timeout: 2000 });
    await user.selectOptions(screen.getByLabelText("Runs after"), "09:00");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ hour: 9 });
    await user.selectOptions(screen.getByLabelText("Minimum score"), "80 of 100");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ minScore: 80 });
    await user.selectOptions(screen.getByLabelText("Postings scored per run"), "20");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ maxScores: 20 });
  });

  it("prepares no drafts on its own unless asked, and then up to the cap", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByLabelText("Drafts per run, at most")).toBeDisabled();
    const toggle = screen.getByRole("switch", { name: "Prepare drafts on its own" });
    expect(toggle).toHaveAccessibleDescription("Off. You choose which postings get a draft with Prepare draft.");
    await user.click(toggle);
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ autoDraft: true });
    await user.selectOptions(screen.getByLabelText("Drafts per run, at most"), "5");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ maxDrafts: 5 });
    expect(toggle).toHaveAccessibleDescription(/up to 5 drafts/);
  });

  it("explains the limits in plain words", () => {
    open();
    expect(screen.getByText(/^One search a day, and at most three in any 24 hours\. Each run scores up to 15 postings\./)).toBeInTheDocument();
  });

  it("points to the source or AI provider while one isn't set up", () => {
    const { unmount } = open({ source: null });
    expect(screen.getByRole("note")).toHaveTextContent("The agent searches the source you choose in Settings → Job search, which is off. Choose one first.");
    expect(screen.getByRole("link", { name: "Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
    unmount();
    open({ aiReady: false });
    expect(screen.getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
  });

  it("switches back and says why when a change isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(saveAgentSettings).mockResolvedValueOnce({ ok: false, error: "Type what the agent should look for before turning it on." });
    open();
    await user.click(screen.getByRole("switch", { name: "Run the job agent" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "false"));
    expect(toast).toHaveBeenCalledWith("Type what the agent should look for before turning it on.");
  });
});
