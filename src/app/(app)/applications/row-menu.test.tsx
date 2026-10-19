import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { deleteApplication, setArchived } from "@/lib/application-actions";
import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";

import { ApplicationsScreen } from "./applications-screen";

vi.mock("./actions", () => ({ rememberListView: vi.fn(async () => ({ ok: true, data: null })) }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn(async () => true) }));
vi.mock("@/lib/application-actions", () => ({
  setArchived: vi.fn(async () => ({ ok: true, data: null })),
  deleteApplication: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id,
  company: "Quill & Co",
  role: "UX Designer",
  location: "",
  mode: "Remote",
  status: "DECLINED",
  archived: false,
  deadline: null,
  match: null,
  sent: "10 Aug",
  updated: "4 weeks ago",
  updatedAt: Date.UTC(2026, 7, 31),
  ...extra,
});
const params = { view: "table" as const, filter: "all" as const, q: "", sort: DEFAULT_SORT, archived: false };
const open = (extra = {}) =>
  render(
    <ApplicationsScreen params={params} rows={[row("quill")]} counts={{ all: 1, active: 0, closed: 1 }} summary="1 application" empty={false} archivedCount={0} {...extra} />,
  );
const menu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Actions for UX Designer, Quill & Co" }));
  return screen.getByRole("menu");
};

beforeEach(() => {
  vi.mocked(setArchived).mockClear();
  vi.mocked(deleteApplication).mockClear();
  vi.mocked(toast).mockClear();
  router.push.mockClear();
});

describe("archiving and deleting from a row (E9-5)", () => {
  it("archives with Undo on the toast", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Archive" }));
    expect(setArchived).toHaveBeenCalledWith({ id: "quill", archived: true });
    expect(toast).toHaveBeenCalledWith("Archived. It's off your board, and still counts on your dashboard.", {
      action: expect.objectContaining({ label: "Undo" }),
    });
    vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick();
    expect(setArchived).toHaveBeenLastCalledWith({ id: "quill", archived: false });
  });

  it("brings an archived one back", async () => {
    const user = userEvent.setup();
    open({ rows: [row("quill", { archived: true })], params: { ...params, archived: true }, archivedCount: 1 });
    expect(screen.getByText("Archived")).toBeInTheDocument();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Unarchive" }));
    expect(setArchived).toHaveBeenCalledWith({ id: "quill", archived: false });
  });

  it("asks before deleting, and clicks in the dialog don't open the row", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Delete…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this application?" });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByText(/can't be undone/));
    expect(router.push).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Delete application" }));
    expect(deleteApplication).toHaveBeenCalledWith({ id: "quill" });
    expect(toast).toHaveBeenCalledWith("Application deleted.");
  });

  it("cancels a delete", async () => {
    const user = userEvent.setup();
    open();
    await user.click(within(await menu(user)).getByRole("menuitem", { name: "Delete…" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleteApplication).not.toHaveBeenCalled();
  });

  it("shows archived applications on request", async () => {
    const user = userEvent.setup();
    const { unmount } = open();
    expect(screen.queryByRole("button", { name: /Show archived/ })).not.toBeInTheDocument();
    unmount();
    open({ archivedCount: 2 });
    await user.click(screen.getByRole("button", { name: "Show archived 2" }));
    expect(router.push).toHaveBeenCalledWith("/applications?view=table&archived=1", { scroll: false });
  });
});
