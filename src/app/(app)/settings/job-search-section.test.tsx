import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSource } from "@/lib/job-search/search";
import { SOURCE_INFO, type JobKeyState, type JobSearchSettingsView, type PortalView } from "@/lib/job-search/sources";

import { browsePortals, installFromCatalog, keepWithdrawnPortal, updatePortal, installPortalConfig, previewPortal, removePortal, savePortalField, savePortalKey, setPortalOn, testPortal, updateSettings } from "./actions";
import { PortalCatalog } from "./browse-portals";
import { JobSearchSection } from "./job-search-section";

vi.mock("./actions", () => ({
  setPortalOn: vi.fn(),
  savePortalField: vi.fn(),
  savePortalKey: vi.fn(),
  testPortal: vi.fn(),
  updateSettings: vi.fn(),
  previewPortal: vi.fn(),
  installPortalConfig: vi.fn(),
  removePortal: vi.fn(),
  browsePortals: vi.fn(),
  installFromCatalog: vi.fn(),
  updatePortal: vi.fn(),
  keepWithdrawnPortal: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const ACCEPTED = "2026-10-23T09:00:00.000Z";
const NOTE = "The Bundesagentur für Arbeit has no official API.";

type Change = { on?: boolean; acceptedAt?: string | null; host?: string; appId?: string; keyState?: JobKeyState; envName?: string | null };

function portalView(id: JobSource, change: Change = {}): PortalView {
  const key = (label: string, envName: string) => ({ name: "key", label, type: "secret" as const, keyState: change.keyState ?? "none", envName: change.envName === undefined ? envName : change.envName });
  const fields: PortalView["fields"] =
    id === "JSEARCH"
      ? [key("API key", "DOSSIER_JSEARCH_KEY"), { name: "host", label: "Key from", type: "choice", value: change.host ?? "openwebninja", options: [{ value: "openwebninja", label: "OpenWeb Ninja" }, { value: "rapidapi", label: "RapidAPI" }] }]
      : id === "ADZUNA"
        ? [{ name: "appId", label: "App ID", type: "text", value: change.appId ?? "" }, key("App key", "DOSSIER_ADZUNA_KEY")]
        : [];
  const { name, description, tag, keyUrl, quotaPeriod, countries, kinds } = SOURCE_INFO[id];
  return { id, name, description, tag, keyUrl, quotaPeriod, countries: countries ? [...countries] : null, kinds: [...kinds], installed: null, version: "1.0.0", withdrawal: null, update: null, on: change.on ?? false, consent: id === "ARBEITSAGENTUR" ? NOTE : null, acceptedAt: change.acceptedAt ?? null, fields };
}

const viewOf = (changes: Partial<Record<JobSource, Change>> = {}, { withBa = true, freehire = "freehire.me" } = {}): JobSearchSettingsView => ({
  portals: (["JSEARCH", "ADZUNA", "FREEHIRE", "ARBEITSAGENTUR"] as const).filter((id) => withBa || id !== "ARBEITSAGENTUR").map((id) => portalView(id, changes[id])),
  freehire: { host: freehire },
});

beforeEach(() => {
  vi.mocked(setPortalOn).mockReset().mockImplementation(async ({ portal, on, accepted }) => ({ ok: true, data: viewOf({ [portal]: { on, acceptedAt: accepted ? ACCEPTED : null } }) }));
  vi.mocked(savePortalField).mockReset().mockImplementation(async ({ portal, field, value }) => ({ ok: true, data: viewOf({ [portal]: { on: true, [field]: value } }) }));
  vi.mocked(savePortalKey).mockReset().mockResolvedValue({ ok: true, data: viewOf({ JSEARCH: { on: true, keyState: "set" } }) });
  vi.mocked(testPortal).mockReset().mockResolvedValue({ ok: true, data: { connected: true, seconds: 0.8 } });
});

describe("JobSearchSection", () => {
  it("lists every portal with its own switch, all off by default", () => {
    render(<JobSearchSection initial={viewOf()} />);
    expect(screen.getByRole("heading", { name: "Job search" })).toBeInTheDocument();
    expect(screen.getAllByRole("switch").map((toggle) => toggle.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "false"]);
    for (const name of ["JSearch", "Adzuna", "FreeHire", "Bundesagentur für Arbeit"]) expect(screen.getByRole("switch", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Test connection/ })).not.toBeInTheDocument();
  });

  it("switches several portals on, each saying what's sent to it", async () => {
    const { rerender } = render(<JobSearchSection initial={viewOf()} />);
    await userEvent.click(screen.getByRole("switch", { name: /^JSearch/ }));
    expect(setPortalOn).toHaveBeenCalledWith({ portal: "JSEARCH", on: true });
    expect(screen.getByRole("note")).toHaveTextContent("Your searches (keywords, place and filters) go to JSearch. Nothing from your profile does.");
    expect(screen.getByRole("link", { name: "OpenWeb Ninja" })).toHaveAttribute("href", "https://www.openwebninja.com/api/jsearch");

    rerender(<JobSearchSection key="two" initial={viewOf({ JSEARCH: { on: true }, FREEHIRE: { on: true } })} />);
    expect(screen.getAllByRole("note")).toHaveLength(2);
    expect(screen.getByText("No key needed. Dossier searches FreeHire's public catalogue at freehire.me.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection to JSearch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection to FreeHire" })).toBeInTheDocument();
  });

  it("switches a portal off", async () => {
    render(<JobSearchSection initial={viewOf({ ADZUNA: { on: true } })} />);
    await userEvent.click(screen.getByRole("switch", { name: /^Adzuna/ }));
    expect(setPortalOn).toHaveBeenCalledWith({ portal: "ADZUNA", on: false });
  });

  it("saves a key when you leave the field, then forgets it in the browser", async () => {
    render(<JobSearchSection initial={viewOf({ JSEARCH: { on: true } })} />);
    await userEvent.type(screen.getByLabelText("API key"), "ak_secret");
    await userEvent.tab();
    expect(savePortalKey).toHaveBeenCalledWith({ portal: "JSEARCH", field: "key", change: { action: "set", value: "ak_secret" } });
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(savePortalKey).toHaveBeenLastCalledWith({ portal: "JSEARCH", field: "key", change: { action: "clear" } });
  });

  it("switches where the JSearch key is from, and where to get one", async () => {
    render(<JobSearchSection initial={viewOf({ JSEARCH: { on: true } })} />);
    await userEvent.click(screen.getByRole("radio", { name: "RapidAPI" }));
    expect(savePortalField).toHaveBeenCalledWith({ portal: "JSEARCH", field: "host", value: "rapidapi" });
    expect(await screen.findByRole("link", { name: "JSearch on RapidAPI" })).toHaveAttribute("href", "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch");
  });

  it("asks Adzuna for an app ID and key, saving the ID when you leave it", async () => {
    render(<JobSearchSection initial={viewOf({ ADZUNA: { on: true } })} />);
    await userEvent.type(screen.getByLabelText("App ID"), "app-1");
    await userEvent.tab();
    expect(savePortalField).toHaveBeenCalledWith({ portal: "ADZUNA", field: "appId", value: "app-1" });
    expect(screen.getByLabelText("App key")).toBeInTheDocument();
  });

  it("switches the Arbeitsagentur on only once its note is ticked (#223)", async () => {
    render(<JobSearchSection initial={viewOf()} />);
    await userEvent.click(screen.getByRole("switch", { name: /^Bundesagentur/ }));
    expect(setPortalOn).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(NOTE))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Test connection/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" }));
    await waitFor(() => expect(setPortalOn).toHaveBeenCalledWith({ portal: "ARBEITSAGENTUR", on: true, accepted: true }));
    expect(await screen.findByText(/The job agent doesn't search this portal/)).toBeInTheDocument();
  });

  it("switches it on again without a second tick once it was accepted", async () => {
    render(<JobSearchSection initial={viewOf({ ARBEITSAGENTUR: { acceptedAt: ACCEPTED } })} />);
    await userEvent.click(screen.getByRole("switch", { name: /^Bundesagentur/ }));
    expect(setPortalOn).toHaveBeenCalledWith({ portal: "ARBEITSAGENTUR", on: true });
  });

  it("leaves the Arbeitsagentur out when the server doesn't offer it", () => {
    render(<JobSearchSection initial={viewOf({}, { withBa: false })} />);
    expect(screen.queryByRole("switch", { name: /^Bundesagentur/ })).not.toBeInTheDocument();
  });

  it("says when it searches a self-hosted FreeHire", () => {
    render(<JobSearchSection initial={viewOf({ FREEHIRE: { on: true } }, { freehire: "jobs.example.org" })} />);
    expect(screen.getByText("No key needed. Dossier searches your own FreeHire at jobs.example.org.")).toBeInTheDocument();
  });

  it("shows keys from the environment and keys that can't be read", () => {
    render(<JobSearchSection initial={viewOf({ JSEARCH: { on: true, keyState: "env" }, ADZUNA: { on: true, keyState: "unreadable" } })} />);
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Using DOSSIER_JSEARCH_KEY · type one to save it here");
    expect(screen.getByText("Your saved key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests one portal and says how it went", async () => {
    render(<JobSearchSection initial={viewOf({ JSEARCH: { on: true, keyState: "set" }, FREEHIRE: { on: true } })} />);
    expect(screen.getByText(/a test uses one search from your plan/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Test connection to JSearch" }));
    expect(testPortal).toHaveBeenCalledWith({ portal: "JSEARCH" });
    expect(await screen.findByText("Connected · JSearch answered in 0.8 s")).toBeInTheDocument();

    vi.mocked(testPortal).mockResolvedValue({ ok: true, data: { connected: false, message: "FreeHire isn't answering right now. Try again in a minute." } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection to FreeHire" }));
    expect(await screen.findByText("FreeHire isn't answering right now. Try again in a minute.")).toBeInTheDocument();
    // Each portal says how its own test went.
    expect(screen.getByText("Connected · JSearch answered in 0.8 s")).toBeInTheDocument();
  });

  it("says when untouched postings move to the Archive, and saves a change (E22-7)", async () => {
    vi.mocked(updateSettings).mockResolvedValue({ ok: true, data: null });
    render(<JobSearchSection initial={viewOf()} archiveDays={30} />);
    const days = screen.getByRole("combobox", { name: "Move untouched postings to the archive after" });
    expect(days).toHaveValue("30");
    expect([...days.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["14 days", "30 days", "60 days", "90 days"]);
    await userEvent.selectOptions(days, "90");
    expect(updateSettings).toHaveBeenCalledWith({ archiveAfterDays: 90 });
    expect(days).toHaveValue("90");
  });

});

describe("Add portal (E23-3)", () => {
  const preview = {
    text: '{"id":"SAMPLE_JSON"}',
    id: "SAMPLE_JSON",
    name: "Sample Board",
    version: "1.0.0",
    description: "A JSON API.",
    countries: ["de", "at"],
    kinds: ["any"],
    hosts: ["api.sample.example"],
    asks: ["API key"],
    termsUrl: "https://sample.example/terms",
    reviewed: false,
    installedVersion: null,
  };
  const added: PortalView = { ...portalView("JSEARCH"), id: "SAMPLE_JSON", name: "Sample Board", installed: { origin: "file", reviewed: false, termsUrl: "https://sample.example/terms" } };

  it("takes a list one a line for a portal that asks once for each entry, saving it when you leave it (E23)", async () => {
    const boards: PortalView = { ...added, id: "SAMPLE_BOARDS", name: "Sample Boards", on: true, fields: [{ name: "boards", label: "Boards", type: "list", value: "", max: 25, help: "A board's name or link." }] };
    render(<JobSearchSection initial={{ ...viewOf(), portals: [...viewOf().portals, boards] }} />);
    const field = screen.getByLabelText("Boards");
    expect(field.tagName).toBe("TEXTAREA");
    expect(screen.getByText("A board's name or link. One a line, up to 25.")).toBeInTheDocument();
    await userEvent.type(field, "acme{enter}globex");
    await userEvent.tab();
    expect(savePortalField).toHaveBeenCalledWith({ portal: "SAMPLE_BOARDS", field: "boards", value: "acme\nglobex" });
  });

  it("shows a config from a file before adding it: what it is, every host it reaches, what it asks for, and that it's not reviewed", async () => {
    vi.mocked(previewPortal).mockResolvedValue({ ok: true, data: { ok: true, preview } });
    vi.mocked(installPortalConfig).mockResolvedValue({ ok: true, data: { ...viewOf(), portals: [...viewOf().portals, added] } });
    const { container } = render(<JobSearchSection initial={viewOf()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add portal" }));
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, new File([preview.text], "sample.json", { type: "application/json" }));
    expect(previewPortal).toHaveBeenCalledWith({ text: preview.text });
    expect(await screen.findByRole("heading", { name: /Sample Board/ })).toBeInTheDocument();
    expect(screen.getByText("Germany and Austria")).toBeInTheDocument();
    expect(screen.getByText("api.sample.example")).toBeInTheDocument();
    expect(screen.getByText("API key")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sample\.example/ })).toHaveAttribute("href", "https://sample.example/terms");
    expect(screen.getByRole("note")).toHaveTextContent(/^Not reviewed\. Nobody has checked this config\./);
    await userEvent.click(screen.getByRole("button", { name: "Add Sample Board" }));
    expect(installPortalConfig).toHaveBeenCalledWith({ text: preview.text, origin: "file", originUrl: null });
    expect(await screen.findByRole("switch", { name: /^Sample Board/ })).toBeInTheDocument();
    expect(screen.getByText("Added from a file · Not reviewed")).toBeInTheDocument();
  });

  it("says what's wrong with a link that isn't a config", async () => {
    vi.mocked(previewPortal).mockResolvedValue({ ok: true, data: { ok: false, problems: ["hosts: Invalid input"] } });
    render(<JobSearchSection initial={viewOf()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add portal" }));
    await userEvent.type(screen.getByLabelText("Or a link to one"), "https://example.com/portal.json");
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(previewPortal).toHaveBeenCalledWith({ url: "https://example.com/portal.json" });
    expect(await screen.findByText("This isn't a portal config Dossier can use:")).toBeInTheDocument();
    expect(screen.getByText("hosts: Invalid input")).toBeInTheDocument();
  });

  it("removes a portal the user added, once that's confirmed", async () => {
    vi.mocked(removePortal).mockResolvedValue({ ok: true, data: viewOf() });
    render(<JobSearchSection initial={{ ...viewOf(), portals: [...viewOf().portals, added] }} />);
    expect(screen.getByRole("link", { name: /Its terms/ })).toHaveAttribute("href", "https://sample.example/terms");
    await userEvent.click(screen.getByRole("button", { name: "Remove portal Sample Board" }));
    await userEvent.click(screen.getByRole("alertdialog", { name: "Remove Sample Board?" }).querySelector("button:last-child")!);
    expect(removePortal).toHaveBeenCalledWith({ portal: "SAMPLE_JSON" });
    await waitFor(() => expect(screen.queryByRole("switch", { name: /^Sample Board/ })).not.toBeInTheDocument());
  });
});

describe("the catalog (E23-4, E23-5)", () => {
  const catalogEntry = (id: string, state: "built-in" | "added" | "available", extra: Record<string, unknown> = {}) => ({
    id,
    name: id === "JSEARCH" ? "JSearch" : "Canal Board",
    version: "1.0.0",
    description: "Design jobs.",
    countries: id === "JSEARCH" ? null : ["nl"],
    kinds: ["any"],
    access: id === "JSEARCH" ? "official-api" : "public-feed",
    needsKey: id === "JSEARCH",
    builtIn: id === "JSEARCH",
    termsUrl: "https://board.example/terms",
    hosts: ["api.board.example"],
    asks: [],
    remoteOnly: false,
    needsList: false,
    state,
    installedVersion: null,
    ...extra,
  });

  it("lists reviewed portals, filtered by country, and adds one after showing what it reaches", async () => {
    vi.mocked(browsePortals).mockResolvedValue({ ok: true, data: { readAt: "2026-11-16T10:00:00.000Z", portals: [catalogEntry("JSEARCH", "built-in"), catalogEntry("CANAL", "available")] } });
    vi.mocked(installFromCatalog).mockResolvedValue({ ok: true, data: { view: viewOf(), catalog: { readAt: "2026-11-16T10:00:00.000Z", portals: [catalogEntry("JSEARCH", "built-in"), catalogEntry("CANAL", "added")] } } });
    // The catalog opens in the column beside the section (#522).
    const { unmount } = render(
      <>
        <JobSearchSection initial={viewOf()} />
        <aside aria-label="Beside">
          <PortalCatalog />
        </aside>
      </>,
    );
    expect(screen.getByRole("complementary", { name: "Beside" })).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole("button", { name: "Browse portals" }));
    const list = await within(screen.getByRole("complementary", { name: "Beside" })).findByRole("list", { name: "Portals in the catalog" });
    expect(screen.getByRole("heading", { name: "Browse portals" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close the catalog" })).toHaveAttribute("aria-expanded", "true");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("JSearchBuilt inOfficial APINeeds a key");
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("Canal BoardReviewedPublic feedFree");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Country" }), "nl");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(within(list).getByRole("button", { name: "Add Canal Board" }));
    expect(within(list).getByText("api.board.example")).toBeInTheDocument();
    expect(installFromCatalog).not.toHaveBeenCalled();
    await userEvent.click(within(list).getByRole("button", { name: "Add Canal Board" }));
    expect(installFromCatalog).toHaveBeenCalledWith({ portal: "CANAL" });
    expect(await within(list).findByText("Added.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("complementary", { name: "Beside" })).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Browse portals" })).toHaveFocus();
    unmount();
  });

  it("says when the catalog can't be reached", async () => {
    vi.mocked(browsePortals).mockResolvedValue({ ok: true, data: { readAt: null, portals: [] } });
    render(
      <>
        <JobSearchSection initial={viewOf()} />
        <PortalCatalog />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Browse portals" }));
    expect(await screen.findByText(/The catalog can't be reached right now/)).toBeInTheDocument();
  });

  it("shows an update with what changed, and asks to approve a new host first", async () => {
    const updating = viewOf({ JSEARCH: { on: true } });
    updating.portals[0] = { ...updating.portals[0], update: { from: "1.0.0", to: "1.1.0", newHosts: ["cdn.jsearch.example"], changes: ["Adds Austria."] } };
    vi.mocked(updatePortal).mockResolvedValue({ ok: true, data: viewOf({ JSEARCH: { on: true } }) });
    render(<JobSearchSection initial={updating} />);
    expect(screen.getByText("Update available: version 1.0.0 → 1.1.0")).toBeInTheDocument();
    expect(screen.getByText("Adds Austria.")).toBeInTheDocument();
    const update = screen.getByRole("button", { name: "Update JSearch" });
    expect(update).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("checkbox", { name: /Let it reach cdn\.jsearch\.example/ }));
    await userEvent.click(update);
    expect(updatePortal).toHaveBeenCalledWith({ portal: "JSEARCH", approvedHosts: ["cdn.jsearch.example"] });
    await waitFor(() => expect(screen.queryByText(/Update available/)).not.toBeInTheDocument());
  });

  it("says a withdrawn portal is paused, and why, until it's kept", async () => {
    const withdrawn = viewOf({ FREEHIRE: { on: true } });
    withdrawn.portals[2] = { ...withdrawn.portals[2], withdrawal: { reason: "Its terms changed.", withdrawnAt: "2026-11-16T09:00:00Z", paused: true } };
    vi.mocked(keepWithdrawnPortal).mockResolvedValue({ ok: true, data: viewOf({ FREEHIRE: { on: true } }) });
    render(<JobSearchSection initial={withdrawn} />);
    expect(screen.getByText(/Withdrawn from the catalog, so it's paused:/).closest("[role=note]")).toHaveTextContent("Its terms changed.");
    await userEvent.click(screen.getByRole("button", { name: "Keep searching FreeHire" }));
    expect(keepWithdrawnPortal).toHaveBeenCalledWith({ portal: "FREEHIRE" });
    await waitFor(() => expect(screen.queryByText(/Withdrawn from the catalog/)).not.toBeInTheDocument());
  });
});
