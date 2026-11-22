import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScoreRing } from "./score-ring";

describe("ScoreRing (E27-2)", () => {
  it("shows coverage, never a score out of 100", () => {
    render(<ScoreRing hit={5} total={7} />);
    const ring = screen.getByRole("img", { name: "5 of 7 requirements covered" });
    expect(ring).toHaveTextContent("5/7");
    expect(ring).not.toHaveTextContent("100");
  });

  it("says so when there are no requirements yet", () => {
    render(<ScoreRing hit={0} total={0} size="lg" />);
    expect(screen.getByRole("img", { name: "No requirements to cover yet" })).toHaveTextContent("–");
  });

  it("fills the ring in proportion, at every size", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { container, unmount } = render(<ScoreRing hit={1} total={4} size={size} />);
      const arc = container.querySelectorAll("circle")[1]!;
      const [filled, length] = arc.getAttribute("stroke-dasharray")!.split(" ").map(Number);
      expect(filled / length).toBeCloseTo(0.25);
      unmount();
    }
  });
});
