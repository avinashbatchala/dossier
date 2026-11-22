import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SectionOrderList, type SectionRow } from "./section-order-list";

const row = (name: string): SectionRow => ({ key: "experience", name, usual: "Experience", inSidebar: false });
const list = (name: string, onRename: (key: string, title: string) => void) => (
  <SectionOrderList rows={[row(name)]} sidebar={false} onMove={vi.fn()} onRemove={vi.fn()} onRename={onRename} />
);

describe("renaming a section on one resume", () => {
  it("renames a heading", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(list("Experience", onRename));
    expect(screen.queryByRole("button", { name: /^Use/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rename Experience" }));
    const field = screen.getByRole("textbox", { name: "New heading for Experience" });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, "Relevant experience{Enter}");
    expect(onRename).toHaveBeenCalledWith("experience", "Relevant experience");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("goes back to the usual heading, by button or by typing it", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(list("Work", onRename));
    await user.click(screen.getByRole("button", { name: "Use “Experience”" }));
    expect(onRename).toHaveBeenLastCalledWith("experience", "");

    await user.click(screen.getByRole("button", { name: "Rename Work" }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Experience");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).toHaveBeenLastCalledWith("experience", "");
  });

  it("changes nothing on Cancel", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(list("Experience", onRename));
    await user.click(screen.getByRole("button", { name: "Rename Experience" }));
    await user.type(screen.getByRole("textbox"), "x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(within(screen.getByRole("listitem")).getByRole("button", { name: "Rename Experience" })).toBeInTheDocument();
  });

  it("offers no rename on a row without a usual heading", () => {
    render(<SectionOrderList rows={[{ key: "custom:a", name: "Awards", inSidebar: false }]} sidebar={false} onMove={vi.fn()} onRemove={vi.fn()} onRename={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Rename/ })).not.toBeInTheDocument();
  });
});
