import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { copyText } from "@/lib/copy-text";

import { disconnectClaude, setConnector } from "./actions";
import { ConnectorSection } from "./connector-section";

vi.mock("./actions", () => ({
  setConnector: vi.fn(async ({ on }: { on: boolean }) => ({ ok: true, data: { on } })),
  disconnectClaude: vi.fn(async () => ({ ok: true, data: null, toast: "Claude is disconnected." })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));

const ADDRESS = "https://dossier.example/api/mcp";

beforeEach(() => vi.clearAllMocks());

describe("Settings → Claude connector (#221)", () => {
  it("is off until it's turned on, and then shows the address to add in Claude", async () => {
    const user = userEvent.setup();
    render(<ConnectorSection initial={{ on: false }} address={ADDRESS} />);
    expect(screen.getByRole("heading", { name: "Claude connector" })).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Let Claude connect" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Off. The connector's addresses aren't open on this server.");
    expect(screen.queryByText(ADDRESS)).not.toBeInTheDocument();

    await user.click(toggle);
    expect(setConnector).toHaveBeenCalledWith({ on: true });
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add --transport http dossier https:\/\/dossier\.example\/api\/mcp/)).toBeInTheDocument();
    // A public HTTPS address needs no warning.
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith(ADDRESS);
    expect(toast).toHaveBeenCalledWith("Address copied.");
  });

  it("turns it off again, and puts the switch back when that fails", async () => {
    const user = userEvent.setup();
    render(<ConnectorSection initial={{ on: true }} address={ADDRESS} />);
    vi.mocked(setConnector).mockResolvedValueOnce({ ok: false, error: "Something went wrong on the server. Please try again." });
    await user.click(screen.getByRole("switch", { name: "Let Claude connect" }));
    expect(setConnector).toHaveBeenCalledWith({ on: false });
    expect(screen.getByRole("switch", { name: "Let Claude connect" })).toHaveAttribute("aria-checked", "true");
  });

  it("says Claude on the web needs a public HTTPS address, which a local one isn't", () => {
    render(<ConnectorSection initial={{ on: true }} address="http://localhost:3000/api/mcp" />);
    expect(screen.getByRole("note")).toHaveTextContent(/This is a local address\. Claude on the web, Desktop and mobile reaches Dossier from Anthropic's servers/);
  });

  it("disconnects Claude", async () => {
    const user = userEvent.setup();
    render(<ConnectorSection initial={{ on: true }} address={ADDRESS} />);
    await user.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    expect(disconnectClaude).toHaveBeenCalledWith({});
  });
});
