import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LevelsField } from "./levels-field";
import { guessProfileLevels, setProfileLevels } from "./profiles-actions";

vi.mock("./profiles-actions", () => ({ setProfileLevels: vi.fn(), guessProfileLevels: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

beforeEach(() => vi.clearAllMocks());

describe("LevelsField (E24-3)", () => {
  it("saves once both ends are chosen, in order", async () => {
    vi.mocked(setProfileLevels).mockResolvedValue({ ok: true, data: { from: "senior", to: "lead" } });
    const saved = vi.fn();
    const user = userEvent.setup();
    render(<LevelsField profileId="p1" initial={null} onSaved={saved} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not chosen yet.");
    await user.selectOptions(screen.getByLabelText("From"), "lead");
    expect(setProfileLevels).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("To"), "senior");
    expect(setProfileLevels).toHaveBeenCalledWith({ profileId: "p1", levels: { from: "senior", to: "lead" } });
    expect(saved).toHaveBeenCalledWith({ from: "senior", to: "lead" });
    expect(screen.getByRole("status")).toHaveTextContent("For Senior to Lead or director.");
  });

  it("fills them with Guess with AI, which the user can change", async () => {
    vi.mocked(guessProfileLevels).mockResolvedValue({ ok: true, data: { from: "mid", to: "senior" } });
    const user = userEvent.setup();
    render(<LevelsField profileId="p1" initial={{ from: "junior", to: "junior" }} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Guess with AI" }));
    expect(guessProfileLevels).toHaveBeenCalledWith({ profileId: "p1" });
    expect(screen.getByLabelText("From")).toHaveValue("mid");
    expect(screen.getByLabelText("To")).toHaveValue("senior");
  });
});
