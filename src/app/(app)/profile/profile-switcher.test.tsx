import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileSwitcher } from "./profile-switcher";
import { deleteProfileAction, newProfile, renameProfileAction } from "./profiles-actions";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./profiles-actions", () => ({ newProfile: vi.fn(), renameProfileAction: vi.fn(), deleteProfileAction: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const profiles = [
  { id: "a", name: "Product Designer" },
  { id: "b", name: "Backend" },
];

beforeEach(() => vi.clearAllMocks());

describe("ProfileSwitcher (E24-2)", () => {
  it("shows the open profile and opens another on this page", async () => {
    const user = userEvent.setup();
    render(<ProfileSwitcher profiles={profiles} current={profiles[0]} path="/resume" />);
    await user.click(screen.getByRole("button", { name: "Profile: Product Designer" }));
    expect(screen.getByRole("menuitemradio", { name: "Product Designer" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Backend" }));
    expect(router.push).toHaveBeenCalledWith("/resume?profile=b");
  });

  it("makes a profile: empty, a copy of one, or from a resume file, which goes on to the import", async () => {
    vi.mocked(newProfile).mockResolvedValue({ ok: true, data: { id: "c" } });
    const user = userEvent.setup();
    render(<ProfileSwitcher profiles={profiles} current={profiles[0]} path="/profile" />);
    await user.click(screen.getByRole("button", { name: "Profile: Product Designer" }));
    await user.click(screen.getByRole("menuitem", { name: "New profile…" }));
    await user.type(screen.getByLabelText("Name"), "Frontend");
    await user.click(screen.getByRole("radio", { name: "A copy" }));
    await user.selectOptions(screen.getByLabelText("Copy of"), "b");
    await user.click(screen.getByRole("button", { name: "Make profile" }));
    expect(newProfile).toHaveBeenCalledWith({ start: "copy", name: "Frontend", from: "b" });
    expect(router.push).toHaveBeenCalledWith("/profile?profile=c");

    await user.click(screen.getByRole("button", { name: "Profile: Product Designer" }));
    await user.click(screen.getByRole("menuitem", { name: "New profile…" }));
    await user.type(screen.getByLabelText("Name"), "Data");
    await user.click(screen.getByRole("radio", { name: "A resume file" }));
    await user.click(screen.getByRole("button", { name: "Make profile" }));
    expect(newProfile).toHaveBeenLastCalledWith({ start: "file", name: "Data" });
    expect(router.push).toHaveBeenLastCalledWith("/profile/import?profile=c");
  });

  it("asks an empty profile for its levels before making it (E24-3)", async () => {
    vi.mocked(newProfile).mockResolvedValue({ ok: true, data: { id: "c" } });
    const user = userEvent.setup();
    render(<ProfileSwitcher profiles={profiles} current={profiles[0]} path="/profile" />);
    await user.click(screen.getByRole("button", { name: "Profile: Product Designer" }));
    await user.click(screen.getByRole("menuitem", { name: "New profile…" }));
    await user.type(screen.getByLabelText("Name"), "Backend");
    await user.click(screen.getByRole("button", { name: "Make profile" }));
    expect(newProfile).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("From"), "senior");
    await user.selectOptions(screen.getByLabelText("To"), "lead");
    await user.click(screen.getByRole("button", { name: "Make profile" }));
    expect(newProfile).toHaveBeenCalledWith({ start: "empty", name: "Backend", levels: { from: "senior", to: "lead" } });
  });

  it("renames the open profile, and deletes it once confirmed, unless it's the only one", async () => {
    vi.mocked(renameProfileAction).mockResolvedValue({ ok: true, data: null });
    vi.mocked(deleteProfileAction).mockResolvedValue({ ok: true, data: { id: "a" } });
    const user = userEvent.setup();
    const { unmount } = render(<ProfileSwitcher profiles={profiles} current={profiles[1]} path="/profile" />);
    await user.click(screen.getByRole("button", { name: "Profile: Backend" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename “Backend”…" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Platform");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(renameProfileAction).toHaveBeenCalledWith({ id: "b", name: "Platform" });

    await user.click(screen.getByRole("button", { name: "Profile: Backend" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete “Backend”…" }));
    await user.click(screen.getByRole("button", { name: "Delete profile" }));
    expect(deleteProfileAction).toHaveBeenCalledWith({ id: "b" });
    expect(router.push).toHaveBeenCalledWith("/profile?profile=a");
    unmount();

    render(<ProfileSwitcher profiles={[profiles[0]]} current={profiles[0]} path="/profile" />);
    await user.click(screen.getByRole("button", { name: "Profile: Product Designer" }));
    expect(screen.getByRole("menuitem", { name: "Delete “Product Designer”…" })).toHaveAttribute("aria-disabled", "true");
  });
});
