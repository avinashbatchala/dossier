import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSource } from "@/lib/job-search/search";
import { SOURCE_INFO, type JobSearchSettingsView, type PortalView } from "@/lib/job-search/sources";

import { installFromCatalog, savePortalField, savePortalKey, setPortalOn, testPortal } from "../../(app)/settings/actions";
import { JobsStep } from "./jobs-step";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../(app)/settings/actions", () => ({ setPortalOn: vi.fn(), savePortalField: vi.fn(), savePortalKey: vi.fn(), testPortal: vi.fn(), installFromCatalog: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const ok = { ok: true as const, data: null as never };
const portal = (id: JobSource, on = false): PortalView => {
  const { name, description, tag, keyUrl, quotaPeriod, countries, kinds } = SOURCE_INFO[id];
  const key = { name: "key", label: "API key", type: "secret" as const, keyState: "none" as const, envName: null };
  return {
    id,
    name,
    description,
    tag,
    keyUrl,
    quotaPeriod,
    countries: countries ? [...countries] : null,
    kinds: [...kinds],
    installed: null,
    version: "1.0.0",
    withdrawal: null,
    update: null,
    on,
    consent: id === "ARBEITSAGENTUR" ? "The Bundesagentur für Arbeit has no official API." : null,
    acceptedAt: null,
    fields: id === "JSEARCH" || id === "ADZUNA" ? [key] : [],
  };
};
const view = (on: JobSource[] = []): JobSearchSettingsView => ({
  portals: (["JSEARCH", "ADZUNA", "FREEHIRE", "ARBEITSAGENTUR"] as const).map((id) => portal(id, on.includes(id))),
  freehire: { host: "freehire.me" },
});
const countries = [
  { code: "de", name: "Germany" },
  { code: "se", name: "Sweden" },
];
const open = (initial = view(), country = "de") => render(<JobsStep initial={initial} countries={countries} country={country} />);
const listed = () => screen.getAllByRole("checkbox").map((box) => box.closest("li")!.querySelector("label")!.childNodes[0].textContent);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setPortalOn).mockResolvedValue(ok);
  vi.mocked(savePortalKey).mockResolvedValue(ok);
  vi.mocked(savePortalField).mockResolvedValue(ok);
  vi.mocked(testPortal).mockResolvedValue({ ok: true, data: { connected: true, seconds: 0.4 } });
});

describe("the setup guide's job search step (E22-9)", () => {
  it("asks where and for what, then lists the portals that cover it, each marked", async () => {
    const user = userEvent.setup();
    open(view(["JSEARCH"]));
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveValue("de");
    // Something is on already: its kind is chosen, and nothing more is switched on.
    expect(screen.getByRole("radio", { name: "Any kind of job" })).toBeChecked();
    expect(listed()).toEqual(["JSearch", "Adzuna", "FreeHire", "Bundesagentur für Arbeit"]);
    const jsearch = screen.getByRole("checkbox", { name: /^JSearch/ });
    expect(jsearch).toBeChecked();
    expect(jsearch.closest("li")).toHaveTextContent("Built inNeeds a key");
    expect(screen.getByRole("checkbox", { name: /^FreeHire/ }).closest("li")).toHaveTextContent("Built inFree");
    expect(screen.getByText("More portals in Settings → Job search later.")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Country" }), "se");
    expect(listed()).toEqual(["JSearch", "FreeHire"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Country" }), "anywhere");
    expect(listed()).toEqual(["JSearch", "FreeHire"]);
    expect(setPortalOn).not.toHaveBeenCalled();
  });

  it("switches on the free portals for the kind of work when none is on yet", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("radio", { name: "Mostly tech" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(setPortalOn).toHaveBeenCalledTimes(1);
    expect(setPortalOn).toHaveBeenCalledWith({ portal: "FREEHIRE", on: true });
  });

  it("asks for a key before a portal that needs one goes on, and checks it at once", async () => {
    const user = userEvent.setup();
    open(view(["FREEHIRE"]));
    await user.click(screen.getByRole("checkbox", { name: /^JSearch/ }));
    expect(setPortalOn).not.toHaveBeenCalled();
    const row = screen.getByRole("checkbox", { name: /^JSearch/ }).closest("li")!;
    expect(within(row).getByRole("list", { name: "Setting up JSearch" })).toBeInTheDocument();
    await user.type(within(row).getByLabelText("JSearch API key"), "secret-key");
    await user.click(within(row).getByRole("button", { name: "Check it" }));
    expect(savePortalKey).toHaveBeenCalledWith({ portal: "JSEARCH", field: "key", change: { action: "set", value: "secret-key" } });
    expect(testPortal).toHaveBeenCalledWith({ portal: "JSEARCH" });
    await waitFor(() => expect(setPortalOn).toHaveBeenCalledWith({ portal: "JSEARCH", on: true }));
    expect(within(row).getByText("It works: Dossier can search JSearch.")).toBeInTheDocument();
  });

  it("shows the Bundesagentur's note when it's ticked, and a free portal goes on at once", async () => {
    const user = userEvent.setup();
    open(view(["JSEARCH"]));
    await user.click(screen.getByRole("checkbox", { name: /^Bundesagentur/ }));
    expect(screen.getByRole("checkbox", { name: "I understand, and choose this source myself" })).toBeInTheDocument();
    expect(setPortalOn).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: /^FreeHire/ }));
    expect(setPortalOn).toHaveBeenCalledWith({ portal: "FREEHIRE", on: true });
    await waitFor(() => expect(screen.getByText("It works: Dossier can search FreeHire.")).toBeInTheDocument());
  });

  it("switches every portal off for None for now", async () => {
    const user = userEvent.setup();
    open(view(["JSEARCH", "FREEHIRE"]));
    await user.click(screen.getByRole("radio", { name: "None for now" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(vi.mocked(setPortalOn).mock.calls.map(([input]) => input)).toEqual([
      { portal: "JSEARCH", on: false },
      { portal: "FREEHIRE", on: false },
    ]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("lists the catalog's reviewed portals too, and says more come later only when it can't be reached (E23-4)", async () => {
    vi.mocked(installFromCatalog).mockResolvedValue({ ok: true, data: { view: view(), catalog: { readAt: null, portals: [] } } });
    const entry = { id: "CANAL", name: "Canal Board", version: "1.0.0", description: "Design jobs.", countries: ["de"], kinds: ["any"], access: "public-feed", needsKey: false, builtIn: false, termsUrl: "", hosts: ["api.board.example"], asks: [], remoteOnly: false, needsList: false, state: "available" as const, installedVersion: null };
    const user = userEvent.setup();
    const { unmount } = render(<JobsStep initial={view(["JSEARCH"])} countries={countries} country="de" catalog={[entry]} />);
    expect(screen.queryByText("More portals in Settings → Job search later.")).not.toBeInTheDocument();
    const row = screen.getByRole("checkbox", { name: /^Canal Board/ }).closest("li")!;
    expect(row).toHaveTextContent("Canal BoardReviewedFree");
    await user.click(screen.getByRole("checkbox", { name: /^Canal Board/ }));
    expect(installFromCatalog).toHaveBeenCalledWith({ portal: "CANAL" });
    await waitFor(() => expect(setPortalOn).toHaveBeenCalledWith({ portal: "CANAL", on: true }));
    unmount();
    render(<JobsStep initial={view(["JSEARCH"])} countries={countries} country="de" catalog={null} />);
    expect(screen.getByText("More portals in Settings → Job search later.")).toBeInTheDocument();
  });

  it("ticks a free remote-only portal from the catalog only for remote work, and leaves one that needs a list to Settings (E23)", async () => {
    vi.mocked(installFromCatalog).mockResolvedValue({ ok: true, data: { view: view(), catalog: { readAt: null, portals: [] } } });
    const base = { version: "1.0.0", description: "Jobs.", countries: null, kinds: ["any"], access: "official-api", needsKey: false, builtIn: false, termsUrl: "", hosts: ["feed.example"], asks: [], state: "available" as const, installedVersion: null };
    const catalog = [
      { ...base, id: "FEED", name: "Remote Feed", remoteOnly: true, needsList: false },
      { ...base, id: "BOARDS", name: "Company Boards", remoteOnly: false, needsList: true, asks: ["Boards"] },
    ];
    const user = userEvent.setup();
    const { unmount } = render(<JobsStep initial={view()} countries={countries} country="de" catalog={catalog} />);
    expect(screen.queryByRole("checkbox", { name: /^Company Boards/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Any kind of job/ }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(installFromCatalog).not.toHaveBeenCalled();
    unmount();
    vi.mocked(router.refresh).mockClear();
    render(<JobsStep initial={view()} countries={countries} country="" catalog={catalog} />);
    await user.click(screen.getByRole("radio", { name: /Any kind of job/ }));
    await waitFor(() => expect(installFromCatalog).toHaveBeenCalledWith({ portal: "FEED" }));
    expect(installFromCatalog).not.toHaveBeenCalledWith({ portal: "BOARDS" });
  });
});
