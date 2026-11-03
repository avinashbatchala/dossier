import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSearchSettingsView } from "@/lib/job-search/sources";

import { saveJobSearchDetails, saveJobSource, saveJobSourceKey, testJobSource } from "./actions";
import { JobSearchSection } from "./job-search-section";

vi.mock("./actions", () => ({
  saveJobSource: vi.fn(),
  saveJobSearchDetails: vi.fn(),
  saveJobSourceKey: vi.fn(),
  testJobSource: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const off: JobSearchSettingsView = {
  source: "OFF",
  jsearch: { host: "openwebninja", keyState: "none" },
  adzuna: { appId: "", keyState: "none" },
  arbeitsagentur: { offered: true, acceptedAt: null },
  freehire: { host: "freehire.me" },
};
const ACCEPTED = "2026-10-23T09:00:00.000Z";
const withSource = (view: Partial<JobSearchSettingsView>): JobSearchSettingsView => ({ ...off, ...view });

beforeEach(() => {
  vi.mocked(saveJobSource).mockReset().mockImplementation(async ({ source }) => ({ ok: true, data: withSource({ source }) }));
  vi.mocked(saveJobSearchDetails).mockReset().mockImplementation(async ({ jsearchHost = "openwebninja", adzunaAppId = "" }) => ({
    ok: true,
    data: withSource({ source: "JSEARCH", jsearch: { host: jsearchHost, keyState: "none" }, adzuna: { appId: adzunaAppId, keyState: "none" } }),
  }));
  vi.mocked(saveJobSourceKey).mockReset().mockResolvedValue({ ok: true, data: withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "set" } }) });
  vi.mocked(testJobSource).mockReset().mockResolvedValue({ ok: true, data: { connected: true, seconds: 0.8 } });
});

describe("JobSearchSection", () => {
  it("offers the four sources and Off, as a radio group, Off by default", () => {
    render(<JobSearchSection initial={off} />);
    expect(screen.getByRole("heading", { name: "Job search" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "JSearch",
      "Adzuna",
      "FreeHire",
      "Bundesagentur für Arbeit",
      "Off",
    ]);
    expect(screen.getByRole("radio", { name: "Off" })).toBeChecked();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
  });

  it("saves a source at once and says what's sent to it", async () => {
    render(<JobSearchSection initial={off} />);
    await userEvent.click(screen.getByRole("radio", { name: "JSearch" }));
    expect(saveJobSource).toHaveBeenCalledWith({ source: "JSEARCH" });
    expect(screen.getByRole("note")).toHaveTextContent("Your searches (keywords, place and filters) go to JSearch. Nothing from your profile does.");
    expect(screen.getByRole("link", { name: "OpenWeb Ninja" })).toHaveAttribute("href", "https://www.openwebninja.com/api/jsearch");
  });

  it("saves a key when you leave the field, then forgets it in the browser", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH" })} />);
    await userEvent.type(screen.getByLabelText("API key"), "ak_secret");
    await userEvent.tab();
    expect(saveJobSourceKey).toHaveBeenCalledWith({ source: "JSEARCH", change: { action: "set", value: "ak_secret" } });
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it");
    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveJobSourceKey).toHaveBeenLastCalledWith({ source: "JSEARCH", change: { action: "clear" } });
  });

  it("saves a key on Enter too", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH" })} />);
    await userEvent.type(screen.getByLabelText("API key"), "ak_secret{Enter}");
    expect(saveJobSourceKey).toHaveBeenCalledTimes(1);
  });

  it("switches where the JSearch key is from", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH" })} />);
    await userEvent.click(screen.getByRole("radio", { name: "RapidAPI" }));
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ jsearchHost: "rapidapi" });
    expect(await screen.findByRole("link", { name: "JSearch on RapidAPI" })).toBeInTheDocument();
  });

  it("asks Adzuna for an app ID and key, saving the ID when you leave it", async () => {
    vi.mocked(saveJobSearchDetails).mockResolvedValue({ ok: true, data: withSource({ source: "ADZUNA", adzuna: { appId: "app-1", keyState: "none" } }) });
    render(<JobSearchSection initial={withSource({ source: "ADZUNA" })} />);
    await userEvent.type(screen.getByLabelText("App ID"), "app-1");
    await userEvent.tab();
    expect(saveJobSearchDetails).toHaveBeenCalledWith({ adzunaAppId: "app-1" });
    expect(screen.getByLabelText("App key")).toHaveAttribute("type", "password");
  });

  it("saves the Arbeitsagentur only once its note is ticked (#223)", async () => {
    vi.mocked(saveJobSource).mockResolvedValue({ ok: true, data: withSource({ source: "ARBEITSAGENTUR", arbeitsagentur: { offered: true, acceptedAt: ACCEPTED } }) });
    render(<JobSearchSection initial={off} />);
    await userEvent.click(screen.getByRole("radio", { name: "Bundesagentur für Arbeit" }));
    expect(saveJobSource).not.toHaveBeenCalled();
    expect(screen.getByText(/has no official API\. Dossier searches it through the access its own job search uses, without its permission/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /The BA's terms of use/ })).toHaveAttribute("href", "https://www.arbeitsagentur.de/datei/nutzungsbedingungen_ba036575.pdf");
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" }));
    expect(saveJobSource).toHaveBeenCalledWith({ source: "ARBEITSAGENTUR", accepted: true });
    // Saved: the note stays, without the box, and it can be tested.
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/has no official API/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/key/i)).not.toBeInTheDocument();
    expect(screen.getByText(/The job agent doesn't search this source/)).toBeInTheDocument();
  });

  it("asks people who chose the Arbeitsagentur before to tick the note too", async () => {
    render(<JobSearchSection initial={withSource({ source: "ARBEITSAGENTUR" })} />);
    expect(screen.getByRole("radio", { name: "Bundesagentur für Arbeit" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument();
  });

  it("doesn't save another source's choice as the Arbeitsagentur's", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH" })} />);
    await userEvent.click(screen.getByRole("radio", { name: "Bundesagentur für Arbeit" }));
    await userEvent.click(screen.getByRole("radio", { name: "Adzuna" }));
    expect(saveJobSource).toHaveBeenCalledTimes(1);
    expect(saveJobSource).toHaveBeenCalledWith({ source: "ADZUNA" });
  });

  it("leaves the Arbeitsagentur out when the server doesn't offer it", () => {
    render(<JobSearchSection initial={withSource({ arbeitsagentur: { offered: false, acceptedAt: null } })} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["JSearch", "Adzuna", "FreeHire", "Off"]);
  });

  it("says which FreeHire it searches, with no key to ask for", () => {
    const { unmount } = render(<JobSearchSection initial={withSource({ source: "FREEHIRE" })} />);
    expect(screen.getByText("No key needed. Dossier searches FreeHire's public catalogue at freehire.me.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/key/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument();
    unmount();
    render(<JobSearchSection initial={withSource({ source: "FREEHIRE", freehire: { host: "jobs.example" } })} />);
    expect(screen.getByText("No key needed. Dossier searches your own FreeHire at jobs.example.")).toBeInTheDocument();
  });

  it("shows keys from the environment and keys that can't be read", () => {
    const { unmount } = render(<JobSearchSection initial={withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "env" } })} />);
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Using DOSSIER_JSEARCH_KEY · type one to save it here");
    unmount();
    render(<JobSearchSection initial={withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "unreadable" } })} />);
    expect(screen.getByText("Your saved key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests the connection and says how it went", async () => {
    render(<JobSearchSection initial={withSource({ source: "JSEARCH", jsearch: { host: "openwebninja", keyState: "set" } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("a test uses one search from your plan");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected · JSearch answered in 0.8 s")).toBeInTheDocument();

    vi.mocked(testJobSource).mockResolvedValue({ ok: true, data: { connected: false, message: "JSearch didn't accept your key." } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("JSearch didn't accept your key.")).toBeInTheDocument();

    vi.mocked(testJobSource).mockResolvedValue({ ok: false, error: "Something went wrong on the server. Please try again." });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Something went wrong on the server. Please try again.")).toBeInTheDocument();
  });
});
