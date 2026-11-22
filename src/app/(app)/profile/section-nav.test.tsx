import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SectionNav } from "./section-nav";

vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => <a {...props} /> }));

type Status = "done" | "warn" | "empty";
const row = (id: "basics" | "skills" | "facts", label: string, status: Status, note: string, optional = false, tag?: string) => ({ id, label, title: label, hint: "", optional, status, note, tag });
const rows = [
  row("basics", "Basics", "done", "4 of 4 filled in", false, "All profiles"),
  row("skills", "Skills", "warn", "None yet"),
  row("facts", "Facts about me", "empty", "Optional · none yet", true, "All profiles"),
];

describe("SectionNav (E33-1)", () => {
  it("links to each section with how it stands, a note and the shared tag, and marks the current one", () => {
    render(<SectionNav rows={rows} current="skills" onMove={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Skills Needs a look: None yet" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^Skills/ })).toHaveAttribute("href", "/profile?section=skills");
    expect(screen.getByRole("link", { name: "Basics All profiles Done: 4 of 4 filled in" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /^Facts about me/ })).toHaveTextContent("·Facts about me All profiles Empty: Optional · none yet");
  });

  it("adds a section from the list", () => {
    render(<SectionNav rows={rows} current="new" onMove={vi.fn()} />);
    expect(screen.getByRole("link", { name: "+ Add a section" })).toHaveAttribute("href", "/profile?section=new");
    expect(screen.getByRole("link", { name: "+ Add a section" })).toHaveAttribute("aria-current", "page");
  });

  it("moves any row, Basics and the Facts too, and says so", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<SectionNav rows={rows} current="basics" onMove={onMove} />);
    await user.click(screen.getByRole("button", { name: "Move “Basics” down" }));
    expect(onMove).toHaveBeenLastCalledWith(["skills", "basics", "facts"]);
    expect(screen.getByText("“Basics” moved to position 2 of 3.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move “Facts about me” up" }));
    expect(onMove).toHaveBeenLastCalledWith(["basics", "facts", "skills"]);
  });

  it("does nothing past either end", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<SectionNav rows={rows} current="basics" onMove={onMove} />);
    await user.click(screen.getByRole("button", { name: "Move “Basics” up" }));
    await user.click(screen.getByRole("button", { name: "Move “Facts about me” down" }));
    expect(onMove).not.toHaveBeenCalled();
  });
});
