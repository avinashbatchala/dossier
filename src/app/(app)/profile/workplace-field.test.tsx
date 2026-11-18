import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

import { sawProfileWorkplace, setProfileWorkplace } from "./profiles-actions";
import { WorkplaceField } from "./workplace-field";

vi.mock("./profiles-actions", () => ({ setProfileWorkplace: vi.fn(), sawProfileWorkplace: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const countries = [
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
];
const open = (seen = true) =>
  render(<WorkplaceField profileId="p1" initial={DEFAULT_WORKPLACE} seen={seen} city="Rotterdam" country="Netherlands" countries={countries} onSeen={vi.fn()} />);
const saved = () => vi.mocked(setProfileWorkplace).mock.lastCall?.[0].workplace;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setProfileWorkplace).mockResolvedValue({ ok: true, data: null });
  vi.mocked(sawProfileWorkplace).mockResolvedValue({ ok: true, data: null });
});

describe("WorkplaceField (E24-4)", () => {
  it("counts as looked at once it's open", () => {
    open(false);
    expect(sawProfileWorkplace).toHaveBeenCalledWith({ profileId: "p1" });
  });

  it("shows the defaults from the shared address, and saves each answer as it changes", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByLabelText("On-site and hybrid: how far from home")).toHaveValue("50");
    expect(screen.getByLabelText("On-site and hybrid: how far from home")).toHaveAccessibleDescription("From Rotterdam, the city in your basics.");
    expect(screen.getByRole("radio", { name: "Employers in Netherlands" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "No" })).toBeChecked();

    await user.selectOptions(screen.getByLabelText("On-site and hybrid: how far from home"), "100");
    expect(saved()).toMatchObject({ radiusKm: 100 });
    await user.type(screen.getByLabelText("Other cities or countries"), "Berlin{enter}Belgium");
    await user.tab();
    expect(saved()).toMatchObject({ otherPlaces: ["Berlin", "Belgium"] });

    await user.click(screen.getByRole("radio", { name: "Employers in these countries" }));
    await user.selectOptions(screen.getByLabelText("Add a country"), "de");
    expect(saved()).toMatchObject({ remoteOpenTo: "countries", remoteCountries: ["de"] });
    await user.click(screen.getByRole("button", { name: "× Remove Germany" }));
    expect(saved()).toMatchObject({ remoteCountries: [] });

    await user.click(screen.getByRole("radio", { name: "Yes, to" }));
    await user.type(screen.getByLabelText("Where to"), "Canada");
    await user.tab();
    expect(saved()).toMatchObject({ relocate: true, relocatePlaces: ["Canada"] });
  });

  it("needs at least one way of working, and hides what a way it doesn't take would ask", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("checkbox", { name: "On-site" }));
    await user.click(screen.getByRole("checkbox", { name: "Hybrid" }));
    expect(saved()).toMatchObject({ modes: ["REMOTE"] });
    expect(screen.queryByLabelText("On-site and hybrid: how far from home")).not.toBeInTheDocument();
    vi.mocked(setProfileWorkplace).mockClear();
    await user.click(screen.getByRole("checkbox", { name: "Remote" }));
    expect(setProfileWorkplace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one way of working.");
  });
});
