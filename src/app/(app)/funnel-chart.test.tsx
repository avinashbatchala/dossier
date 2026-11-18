import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FunnelStep } from "@/lib/dashboard";

import { FunnelChart } from "./funnel-chart";

vi.mock("next/link", () => ({ default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} /> }));

const none = { open: 0, rejected: 0, declined: 0, archived: 0 };
// The demo's funnel: 7 sent, one rejected at screening and one offer declined.
const funnel: FunnelStep[] = [
  { stage: "SENT", count: 7, conversion: null, stopped: { ...none, open: 2 } },
  { stage: "SCREENING", count: 5, conversion: 71, stopped: { ...none, open: 1, rejected: 1 } },
  { stage: "INTERVIEW", count: 3, conversion: 60, stopped: { ...none, open: 1 } },
  { stage: "OFFER", count: 2, conversion: 67, stopped: { ...none, open: 1, declined: 1 } },
  { stage: "ACCEPTED", count: 0, conversion: 0, stopped: none },
];

describe("the funnel as a Sankey diagram", () => {
  it("names every stage with its count, and where the ones that stopped are", () => {
    render(<FunnelChart funnel={funnel} />);
    expect(screen.getAllByRole("listitem").map((step) => step.textContent)).toEqual([
      "Sent7Everything you've sent",
      "Screening571% of sent",
      "Interview360% of screening",
      "Offer267% of interview",
      "Accepted0None yet",
    ]);
    const ends = ["2 waiting", "1 in screening", "1 rejected", "1 interviewing", "1 deciding", "1 declined"];
    expect(ends.map((name) => screen.getByRole("link", { name }).textContent)).toEqual(ends);
  });

  it("opens each stage's and each end node's applications (E28-2)", () => {
    render(<FunnelChart funnel={funnel} />);
    expect(screen.getByRole("link", { name: /^Screening/ })).toHaveAttribute("href", "/applications?status=screening");
    expect(screen.getByRole("link", { name: /^Accepted/ })).toHaveAttribute("href", "/applications?status=accepted");
    expect(screen.getByRole("link", { name: "2 waiting" })).toHaveAttribute("href", "/applications?status=sent");
    expect(screen.getByRole("link", { name: "1 rejected" })).toHaveAttribute("href", "/applications?status=rejected");
    expect(screen.getByRole("link", { name: "1 declined" })).toHaveAttribute("href", "/applications?status=declined");
    // None of them is inside the picture hidden from screen readers.
    for (const link of screen.getAllByRole("link")) expect(link.closest("[aria-hidden='true']")).toBeNull();
  });

  it("draws the stages to scale, a band for each outcome and room for every label", () => {
    const { container } = render(<FunnelChart funnel={funnel} />);
    const svg = container.querySelector("svg")!;
    // 26 pixels an application (E28-2): Sent is 182 tall, and Sent's two waiting end at 202.
    expect(svg).toHaveAttribute("viewBox", "0 0 1000 202");
    expect(svg.querySelectorAll("path[d$='Z']")).toHaveLength(6);
    const nodes = [...svg.querySelectorAll("rect[width='12']")].map((node) => node.getAttribute("height"));
    expect(nodes).toEqual(["182", "130", "78", "52", "2", "52", "26", "26", "26", "26", "26"]);
  });

  it("tells more on hover, for a stage and for an outcome", () => {
    const { container } = render(<FunnelChart funnel={funnel} />);
    const picture = container.querySelector<HTMLElement>("[aria-hidden='true']")!;
    const [, screening] = container.querySelectorAll("svg > g");
    fireEvent.pointerEnter(screening);
    expect(picture).toHaveTextContent("5 reached screening3 went on to interview, 2 stopped here");
    fireEvent.pointerLeave(screening);

    const rejected = screen.getByRole("link", { name: "1 rejected" });
    fireEvent.pointerEnter(rejected);
    expect(picture).toHaveTextContent("1 rejected at screening20% of screening");
    fireEvent.pointerLeave(rejected);
    expect(picture).not.toHaveTextContent("at screening");

    fireEvent.pointerEnter(screen.getByRole("link", { name: "1 deciding" }));
    expect(picture).toHaveTextContent("1 offer you're deciding on50% of offer");
  });

  it("has every number in a table", async () => {
    const user = userEvent.setup();
    render(<FunnelChart funnel={funnel} />);
    await user.click(screen.getByText("Show the numbers"));
    const table = screen.getByRole("table", { name: /How far your sent applications got/ });
    expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "StageReachedOf the stage beforeStill openRejectedDeclinedArchived",
      "Sent72000",
      "Screening571%1100",
      "Interview360%1000",
      "Offer267%1010",
      "Accepted00%",
    ]);
  });

  it("keeps to the stage names before anything was sent", () => {
    const empty = funnel.map((step): FunnelStep => ({ ...step, count: 0, conversion: null, stopped: none }));
    const { container } = render(<FunnelChart funnel={empty} />);
    expect(screen.getAllByRole("listitem").map((step) => step.textContent)).toEqual([
      "Sent0Everything you've sent",
      "Screening0None yet",
      "Interview0None yet",
      "Offer0None yet",
      "Accepted0None yet",
    ]);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Show the numbers")).not.toBeInTheDocument();
  });
});
