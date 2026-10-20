import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { chooseUsagePing } from "./actions";
import { UsagePingDialog } from "./usage-ping-dialog";

vi.mock("./actions", () => ({ chooseUsagePing: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const open = () => render(<UsagePingDialog host="telemetry.example.com" />);

describe("UsagePingDialog (#172)", () => {
  it("says what's sent, to whom, for how long and how to change it", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "Send a daily usage ping?" });
    expect(dialog).toHaveTextContent("your server would send telemetry.example.com a random install ID and the version number");
    expect(dialog).toHaveTextContent("Nothing else: no profile, documents, applications, settings or server address.");
    expect(dialog).toHaveTextContent("It goes to the Dossier project's maintainer, on the project's own server in Germany.");
    expect(dialog).toHaveTextContent("deleted after a year");
    expect(dialog).toHaveTextContent("Settings → About, or with DOSSIER_TELEMETRY");
    expect(screen.getByRole("link", { name: "dossier.app@pm.me" })).toHaveAttribute("href", "mailto:dossier.app@pm.me");
    expect(screen.getByRole("link", { name: /More in Privacy/ })).toHaveAttribute("href", "https://github.com/AienTech/dossier/blob/main/PRIVACY.md#usage-ping");
    expect(dialog).not.toHaveTextContent(/Cloudflare/);
  });

  it("gives both answers the same weight, with neither preselected", () => {
    open();
    const no = screen.getByRole("button", { name: "Don't send" });
    const yes = screen.getByRole("button", { name: "Send usage ping" });
    expect(no.className).toBe(yes.className);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("sends a yes, and closes", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Send usage ping" }));
    expect(chooseUsagePing).toHaveBeenCalledWith({ send: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends a no", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Don't send" }));
    expect(chooseUsagePing).toHaveBeenCalledWith({ send: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("counts closing it as a no", async () => {
    const user = userEvent.setup();
    open();
    await user.keyboard("{Escape}");
    expect(chooseUsagePing).toHaveBeenCalledWith({ send: false });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays open and says why when the answer isn't saved", async () => {
    vi.mocked(chooseUsagePing).mockResolvedValueOnce({ ok: false, error: "You seem to be offline." });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Send usage ping" }));
    expect(toast).toHaveBeenCalledWith("You seem to be offline.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
