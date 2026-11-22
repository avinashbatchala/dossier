import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Basics } from "@/lib/profile";

import { saveBasics } from "./actions";
import { SummarySection } from "./summary-section";

vi.mock("./actions", () => ({ saveBasics: vi.fn(async () => ({ ok: true, data: null })) }));

const basics = { name: "Jane Doe", summary: "" } as Basics;

function Harness() {
  const [state, setState] = useState(basics);
  return <SummarySection basics={state} onChange={setState} />;
}

describe("SummarySection", () => {
  it("saves the summary with the rest of the basics when you leave the field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("A few lines about you"), "Designs calm tools");
    await user.tab();
    await waitFor(() => expect(saveBasics).toHaveBeenLastCalledWith({ profileId: "", name: "Jane Doe", summary: "Designs calm tools" }));
  });
});
