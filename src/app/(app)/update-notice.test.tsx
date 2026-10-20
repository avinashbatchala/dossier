import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { dismissUpdate } from "@/lib/update-actions";

import { SidebarFrame } from "./sidebar-frame";
import { UpdateNotice } from "./update-notice";

vi.mock("@/lib/update-actions", () => ({ dismissUpdate: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const release = { version: "1.6.0", url: "https://github.com/AienTech/dossier/releases/tag/v1.6.0" };
const renderNotice = () =>
  render(
    <aside>
      <UpdateNotice release={release} currentVersion="1.5.0" />
      <div>
        <button type="button">Sign out</button>
      </div>
    </aside>,
  );

beforeEach(() => vi.clearAllMocks());

describe("UpdateNotice", () => {
  it("says a newer release is out, with what's new and how to update", () => {
    renderNotice();
    const notice = screen.getByRole("region", { name: "Dossier 1.6.0 is out" });
    expect(notice).toHaveTextContent("You have 1.5.0. Update to get its fixes and features.");
    expect(screen.getByRole("link", { name: "What's new (opens in a new tab)" })).toHaveAttribute("href", release.url);
    expect(screen.getByRole("link", { name: "How to update (opens in a new tab)" })).toHaveAttribute("href", "https://github.com/AienTech/dossier/wiki/Upgrading");
  });

  it("goes with Not now, until the next release, and focus moves on", async () => {
    const user = userEvent.setup();
    renderNotice();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(dismissUpdate).toHaveBeenCalledWith({ version: "1.6.0" });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
  });

  it("comes back when that isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(dismissUpdate).mockResolvedValueOnce({ ok: false, error: "You seem to be offline." });
    renderNotice();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(toast).toHaveBeenCalledWith("You seem to be offline.");
    expect(screen.getByRole("region", { name: "Dossier 1.6.0 is out" })).toBeInTheDocument();
  });

  it("is an icon with a dot in the collapsed sidebar, which opens it on the notice", async () => {
    const user = userEvent.setup();
    render(
      <SidebarFrame initialCollapsed brand={<span>Dossier</span>}>
        <UpdateNotice release={release} currentVersion="1.5.0" />
      </SidebarFrame>,
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dossier 1.6.0 is out" }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Dossier 1.6.0 is out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "What's new (opens in a new tab)" })).toHaveFocus();
    expect(document.cookie).toContain("dossier_sidebar=expanded");
    document.cookie = "dossier_sidebar=; max-age=0; path=/";
  });
});
