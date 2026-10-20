import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarItem } from "@/lib/calendar-view";

import { CalendarCard } from "./calendar-card";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// Outside the app router, next/link never calls onNavigate; this one does, as the app router's does on a plain click.
vi.mock("next/link", () => ({
  default: ({ onNavigate, ...props }: ComponentProps<"a"> & { onNavigate?: (event: { preventDefault: () => void }) => void }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.({ preventDefault: () => {} });
      }}
    />
  ),
}));

const items: CalendarItem[] = [
  { id: "nw", title: "Interview · Product Designer · Northwind", kind: "interview", href: "/applications/nw", external: false, allDay: false, start: new Date("2026-10-20T10:00:00Z"), end: new Date("2026-10-20T10:45:00Z") },
  { id: "dentist", title: "Dentist", kind: "event", href: "https://calendar.google.com/event?eid=dentist", external: true, allDay: false, start: new Date("2026-10-23T13:00:00Z"), end: new Date("2026-10-23T13:30:00Z") },
  { id: "trip", title: "Trip", kind: "event", href: null, external: false, allDay: true, startDay: "2026-10-24", endDay: "2026-10-26" },
  { id: "workshop", title: "Workshop", kind: "event", href: null, external: false, allDay: false, start: new Date("2026-11-03T09:00:00Z"), end: new Date("2026-11-03T10:00:00Z") },
];
const props: ComponentProps<typeof CalendarCard> = {
  month: "2026-10-20",
  today: "2026-10-20",
  start: "2026-10-20",
  items,
  timeZone: "Europe/Berlin",
  source: { status: "google" },
  links: { previous: "/?date=2026-09-01", next: "/?date=2026-11-01", today: "/" },
};
const agendaDays = () => screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

describe("the dashboard's calendar (E15-6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks the month's days that have something on, in words too", () => {
    render(<CalendarCard {...props} />);
    const month = screen.getByRole("group", { name: "October 2026" });
    // The whole weeks the month touches, from Monday 28 September.
    expect(within(month).getAllByRole("button")).toHaveLength(35);
    const today = within(month).getByRole("button", { name: "Tuesday 20 October, 1 interview" });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(within(month).getByRole("button", { name: "Saturday 24 October, 1 event" })).toHaveAttribute("aria-pressed", "false");
    expect(within(month).getByRole("button", { name: "Wednesday 21 October" })).toBeInTheDocument();
    expect(screen.getByText("In your time zone (Europe/Berlin).")).toBeInTheDocument();
  });

  it("lists the week from today: interviews open their application, events Google Calendar", () => {
    render(<CalendarCard {...props} />);
    expect(agendaDays()).toEqual(["Today · Tue 20 Oct", "Fri 23 Oct", "Sat 24 Oct", "Sun 25 Oct"]);
    expect(screen.getByRole("link", { name: "12:00–12:45 Interview · Product Designer · Northwind" })).toHaveAttribute("href", "/applications/nw");
    const dentist = screen.getByRole("link", { name: /^15:00–15:30 Dentist/ });
    expect(dentist).toHaveAttribute("href", "https://calendar.google.com/event?eid=dentist");
    expect(dentist).toHaveAttribute("target", "_blank");
    expect(screen.getAllByText("Trip")).toHaveLength(2);
    expect(screen.queryByText("Workshop")).not.toBeInTheDocument();
    // Already on today.
    expect(screen.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
  });

  it("lists the week from the day picked, and back from today", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} />);
    await user.click(screen.getByRole("button", { name: "Sunday 1 November" }));
    expect(screen.getByRole("button", { name: "Sunday 1 November" })).toHaveAttribute("aria-pressed", "true");
    expect(agendaDays()).toEqual(["Tue 3 Nov"]);
    expect(screen.getByText("Workshop")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Monday 26 October" }));
    expect(screen.getByText("Nothing from Mon 26 Oct to Sun 1 Nov.")).toBeInTheDocument();

    // Today's month is on show, so it's picked without loading anything.
    await user.click(screen.getByRole("link", { name: "Today" }));
    expect(agendaDays()[0]).toBe("Today · Tue 20 Oct");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("moves through the days with the arrow keys, one of them in the tab order", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} />);
    const month = screen.getByRole("group", { name: "October 2026" });
    expect(within(month).getAllByRole("button").filter((button) => button.tabIndex === 0)).toEqual([within(month).getByRole("button", { name: /^Tuesday 20 October/ })]);
    await user.click(within(month).getByRole("button", { name: /^Tuesday 20 October/ }));
    await user.keyboard("{ArrowRight}");
    expect(within(month).getByRole("button", { name: "Wednesday 21 October" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    const picked = within(month).getByRole("button", { name: "Wednesday 28 October" });
    expect(picked).toHaveFocus();
    expect(picked).toHaveAttribute("aria-pressed", "true");
    expect(picked.tabIndex).toBe(0);
    expect(agendaDays()).toEqual(["Tue 3 Nov"]);
  });

  it("loads the month before or after in place", async () => {
    const user = userEvent.setup();
    render(<CalendarCard {...props} />);
    expect(screen.getByRole("link", { name: "Previous month" })).toHaveAttribute("href", "/?date=2026-09-01");
    await user.click(screen.getByRole("link", { name: "Next month" }));
    expect(router.push).toHaveBeenCalledWith("/?date=2026-11-01", { scroll: false });
  });

  it("starts on the day asked for, in another month", () => {
    render(<CalendarCard {...props} month="2026-11-01" start="2026-11-01" />);
    expect(screen.getByRole("group", { name: "November 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sunday 1 November" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/");
  });

  it("says why only interviews show, and where to change that", () => {
    const { rerender } = render(<CalendarCard {...props} items={[]} source={{ status: "not-connected" }} />);
    expect(screen.getByText("Nothing in the next 7 days.")).toBeInTheDocument();
    expect(screen.getByText(/Connect Google Calendar in Settings → Google/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → Google" })).toHaveAttribute("href", "/settings?section=google");
    rerender(<CalendarCard {...props} source={{ status: "no-permission" }} />);
    expect(screen.getByText(/Dossier may not use your calendar yet/)).toBeInTheDocument();
    rerender(<CalendarCard {...props} source={{ status: "failed", message: "Google had a problem with that." }} />);
    expect(screen.getByText("Your Google Calendar didn't load: Google had a problem with that.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings → Google" })).not.toBeInTheDocument();
  });
});
