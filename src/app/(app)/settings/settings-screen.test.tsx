import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SectionStatus, SettingsStatus } from "@/lib/settings-status";

import { SettingsOverview } from "./settings-overview";
import { SettingsScreen } from "./settings-screen";

vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => <a {...props} /> }));

const on = (note: string, state = note, meta = ""): SectionStatus => ({ tone: "on", state, meta, note, problem: null });
const status: SettingsStatus = {
  ai: on("Anthropic · claude-sonnet-5-5", "Anthropic · claude-sonnet-5-5 · tested 1.4 s", "Your profile leaves the server when it writes"),
  documents: on("A4 · English"),
  scoring: on("Your AI model"),
  jobs: { tone: "look", state: "1 of 2 portals working. Adzuna has failed since 12 Nov.", meta: "JSearch", note: "Adzuna stopped working", problem: { summary: "Adzuna has failed since 12 Nov", fix: "Fix Adzuna" } },
  agent: on("On · daily at 07:00"),
  google: on("Gmail and Calendar"),
  notifications: on("1 channel"),
  connector: { tone: "off", state: "Use Dossier from Claude and other MCP apps", meta: "Off", note: "Off", problem: null },
  data: on("Backed up today at 02:00"),
  about: { tone: "look", state: "You have 1.15.0 · 1.16.0 is out", meta: "PostgreSQL · 11 applications", note: "1.16.0 is out", problem: { summary: "Dossier 1.16.0 is out", fix: "See what's new" } },
};

describe("SettingsScreen (E34-3)", () => {
  it("lists Overview, then the sections in their groups with how each stands, the current one marked", () => {
    render(
      <SettingsScreen section="data" status={status}>
        <p>Section body</p>
      </SettingsScreen>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("It's your server, so it's your call. Every change saves on its own.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/settings");
    expect(within(nav).getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual(["Writing", "Finding work", "Connected", "Your data · About"]);
    expect(within(within(nav).getByRole("group", { name: "Writing" })).getAllByRole("link").map((link) => link.querySelector("span span")?.textContent)).toEqual(["AI provider", "Documents", "Scoring"]);
    const data = within(nav).getByRole("link", { name: "Data and backups On: Backed up today at 02:00" });
    expect(data).toHaveAttribute("aria-current", "page");
    expect(data).toHaveAttribute("href", "/settings?section=data");
    expect(within(nav).getByRole("link", { name: "Job search Needs a look: Adzuna stopped working" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "MCP connector Off: Off" })).toBeInTheDocument();
    expect(screen.getByText("Section body")).toBeInTheDocument();
  });

  it("shows the overview on its own, without the list", () => {
    render(
      <SettingsScreen section="overview" status={status}>
        <p>The overview</p>
      </SettingsScreen>,
    );
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).not.toBeInTheDocument();
    expect(screen.getByText("The overview")).toBeInTheDocument();
  });
});

describe("SettingsOverview (E34-2)", () => {
  it("leads with what needs a look and its first fix, then a card per section in four groups", () => {
    render(<SettingsOverview status={status} />);
    const banner = screen.getByRole("region", { name: "Needs a look" });
    expect(banner).toHaveTextContent("Two things to look at. Adzuna has failed since 12 Nov and Dossier 1.16.0 is out.");
    expect(within(banner).getByRole("link", { name: "Fix Adzuna" })).toHaveAttribute("href", "/settings?section=jobs");

    const writing = screen.getByRole("region", { name: "Writing" });
    expect(within(writing).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "AI provider On Anthropic · claude-sonnet-5-5 · tested 1.4 s Your profile leaves the server when it writes",
      "Documents On A4 · English ",
      "Scoring On Your AI model ",
    ]);
    expect(within(writing).getByRole("link", { name: /^AI provider/ })).toHaveAttribute("href", "/settings?section=ai");
    expect(screen.getByRole("link", { name: /^Job search Needs a look/ })).toHaveClass("border-warning-line");
    expect(screen.getByRole("link", { name: /^MCP connector Off/ })).toBeInTheDocument();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["Needs a look", "Writing", "Finding work", "Connected", "Your data · About"]);
  });

  it("has no banner when nothing needs a look", () => {
    render(<SettingsOverview status={{ ...status, jobs: on("JSearch"), about: on("1.15.0") }} />);
    expect(screen.queryByRole("region", { name: "Needs a look" })).not.toBeInTheDocument();
  });
});
