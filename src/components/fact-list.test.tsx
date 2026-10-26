import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { createFact, removeFact, restoreFact, saveFact } from "@/lib/fact-actions";
import type { FactItem } from "@/lib/profile";

import { FactList } from "./fact-list";

vi.mock("@/lib/fact-actions", () => ({
  createFact: vi.fn(),
  saveFact: vi.fn(async () => ({ ok: true, data: null })),
  removeFact: vi.fn(async () => ({ ok: true, data: { sort: 0 } })),
  restoreFact: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const research = { id: "f1", text: "I'd like to stay close to user research." };
const notice = { id: "f2", text: "I can start at short notice." };

let latest: FactItem[] = [];
function Harness({ applicationId = null, initial = [research, notice] }: { applicationId?: string | null; initial?: FactItem[] }) {
  const [facts, setFacts] = useState(initial);
  useEffect(() => {
    latest = facts;
  });
  return <FactList applicationId={applicationId} facts={facts} setFacts={(change) => setFacts(change)} placeholder="e.g. something true" />;
}

describe("FactList (PRO-14, APP-15)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows each fact in its own text box, numbered", () => {
    render(<Harness />);
    expect(screen.getByRole("list", { name: "Facts" })).toBeInTheDocument();
    expect(screen.getByLabelText("Fact 1")).toHaveValue(research.text);
    expect(screen.getByLabelText("Fact 2")).toHaveValue(notice.text);
    expect(screen.getByRole("button", { name: "Remove fact 2" })).toBeInTheDocument();
  });

  it("adds a blank fact for the application, focused, and saves what you type", async () => {
    const user = userEvent.setup();
    vi.mocked(createFact).mockResolvedValue({ ok: true, data: { id: "f3", text: "" } });
    render(<Harness applicationId="app-1" initial={[]} />);
    expect(screen.queryByRole("list", { name: "Facts" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add a fact" }));
    expect(createFact).toHaveBeenCalledWith({ applicationId: "app-1" });
    const box = await screen.findByLabelText("Fact 1");
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute("placeholder", "e.g. something true");
    await user.type(box, "I know their product");
    await waitFor(() => expect(saveFact).toHaveBeenLastCalledWith({ id: "f3", text: "I know their product" }), { timeout: 2000 });
  });

  it("says why it couldn't add one", async () => {
    const user = userEvent.setup();
    vi.mocked(createFact).mockResolvedValue({ ok: false, error: "That's 50 facts already. Remove one you no longer need first." });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "+ Add a fact" }));
    expect(toast).toHaveBeenCalledWith("That's 50 facts already. Remove one you no longer need first.");
    expect(latest).toHaveLength(2);
  });

  it("removes a fact at once and puts it back in its place with Undo", async () => {
    const user = userEvent.setup();
    vi.mocked(removeFact).mockResolvedValue({ ok: true, data: { sort: 3 } });
    vi.mocked(restoreFact).mockResolvedValue({ ok: true, data: research });
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Remove fact 1" }));
    expect(removeFact).toHaveBeenCalledWith({ id: "f1" });
    expect(screen.getByLabelText("Fact 1")).toHaveValue(notice.text);
    expect(toast).toHaveBeenCalledWith("Removed a fact.", { action: expect.objectContaining({ label: "Undo" }) });

    const undo = vi.mocked(toast).mock.calls[0][1]!.action!;
    await act(async () => undo.onClick());
    expect(restoreFact).toHaveBeenCalledWith({ id: "f1", applicationId: null, text: research.text, sort: 3 });
    expect(latest.map((fact) => fact.id)).toEqual(["f1", "f2"]);
  });

  it("removes a blank fact without a toast", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ id: "f9", text: "  " }]} />);
    await user.click(screen.getByRole("button", { name: "Remove fact 1" }));
    expect(removeFact).toHaveBeenCalledWith({ id: "f9" });
    expect(toast).not.toHaveBeenCalled();
    expect(latest).toEqual([]);
  });
});
