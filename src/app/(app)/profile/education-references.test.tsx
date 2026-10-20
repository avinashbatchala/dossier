import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileData } from "@/lib/profile";

import { createReference, saveEducation, saveReference } from "./actions";
import { EducationSection } from "./education-section";
import { ReferencesSection } from "./references-section";

vi.mock("./actions", () => ({
  createEducation: vi.fn(),
  saveEducation: vi.fn(async () => ({ ok: true, data: null })),
  removeEducation: vi.fn(async () => ({ ok: true, data: null })),
  restoreEducation: vi.fn(),
  createReference: vi.fn(),
  saveReference: vi.fn(async () => ({ ok: true, data: null })),
  removeReference: vi.fn(async () => ({ ok: true, data: null })),
  restoreReference: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const profile: ProfileData = {
  basics: {} as ProfileData["basics"],
  skills: [],
  languages: [],
  experience: [],
  projects: [],
  education: [
    { id: "d1", degree: "MSc Design for Interaction", school: "TU Delft", notes: "", startYear: 2013, startMonth: null, endYear: 2015, endMonth: null, current: false },
  ],
  references: [
    { id: "r1", name: "John Doe", relation: "Former manager", company: "Northwind Logistics", email: "john.doe@example.com", phone: "" },
  ],
};

function Harness({ section }: { section: "education" | "references" }) {
  const [state, setState] = useState(profile);
  const update = (change: (profile: typeof state) => typeof state) => setState(change);
  return section === "education" ? (
    <EducationSection profile={state} update={update} order="date" />
  ) : (
    <ReferencesSection profile={state} update={update} />
  );
}

describe("Education", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarises an entry: degree, school and dates", () => {
    render(<Harness section="education" />);
    const card = screen.getByRole("button", { name: /MSc Design for Interaction/ });
    expect(card).toHaveTextContent("TU Delft");
    expect(card).toHaveTextContent("2013 – 2015");
    expect(screen.getByRole("button", { name: "+ Add education" })).toBeInTheDocument();
  });

  it("edits the fields, with 'Still studying' in place of the end date", async () => {
    const user = userEvent.setup();
    render(<Harness section="education" />);
    await user.click(screen.getByRole("button", { name: /MSc Design/ }));
    expect(screen.getByLabelText("Degree or course")).toHaveValue("MSc Design for Interaction");
    expect(screen.getByLabelText("School")).toHaveValue("TU Delft");
    expect(screen.getByLabelText("Notes")).toHaveAttribute("placeholder", "Thesis, honours, anything worth mentioning");

    await user.click(screen.getByLabelText("Still studying"));
    expect(screen.getByLabelText("Finished year")).toBeDisabled();
    await waitFor(() => expect(saveEducation).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", current: true })), { timeout: 2000 });
    expect(screen.getByRole("button", { name: /MSc Design/, expanded: true })).toHaveTextContent("2013 – Present");
  });
});

describe("References", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarises a reference: name, relation · company and email", () => {
    render(<Harness section="references" />);
    const card = screen.getByRole("button", { name: /John Doe/ });
    expect(card).toHaveTextContent("Former manager · Northwind Logistics");
    expect(card).toHaveTextContent("john.doe@example.com");
  });

  it("adds a reference and saves what you type", async () => {
    const user = userEvent.setup();
    vi.mocked(createReference).mockResolvedValue({ ok: true, data: { id: "r2", name: "", relation: "", company: "", email: "", phone: "" } });
    render(<Harness section="references" />);
    await user.click(screen.getByRole("button", { name: "+ Add a reference" }));
    expect(await screen.findByRole("button", { name: /New reference/, expanded: true })).toBeInTheDocument();
    for (const label of ["Name", "How you know them", "Company", "Email", "Phone"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await user.type(screen.getByLabelText("Name"), "Jane Doe");
    await waitFor(() => expect(saveReference).toHaveBeenLastCalledWith(expect.objectContaining({ id: "r2", name: "Jane Doe" })), { timeout: 2000 });
  });
});
