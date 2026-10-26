import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileData, PublicationItem } from "@/lib/profile";

import { reorderPublications, savePublication } from "./actions";
import { PublicationsSection } from "./publications-section";

vi.mock("./actions", () => ({
  createPublication: vi.fn(),
  savePublication: vi.fn(async () => ({ ok: true, data: null })),
  removePublication: vi.fn(async () => ({ ok: true, data: null })),
  restorePublication: vi.fn(),
  reorderPublications: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const rossi: PublicationItem = {
  id: "u1",
  citation: "Rossi, S. H., **Dombrowe, V.**, & Massie, C. E. (2025). Evidence of DNA methylation heterogeneity. *Oncogene*, 44(15), 1024–1036.",
  link: "https://doi.org/10.1038/s41388-024-03270-3",
  onResumes: true,
};
const hidden: PublicationItem = { id: "u2", citation: "Dombrowe, V. (2019). A poster.", link: "", onResumes: false };

let latest: ProfileData;
function Harness() {
  const [state, setState] = useState<ProfileData>({
    basics: {} as ProfileData["basics"],
    skills: [],
    languages: [],
    experience: [],
    projects: [],
    education: [],
    publications: [rossi, hidden],
    references: [],
    facts: [],
    photo: null,
  });
  useEffect(() => {
    latest = state;
  });
  return <PublicationsSection profile={state} update={(change) => setState(change)} />;
}

const header = (name: RegExp | string) => screen.getByRole("button", { name, expanded: false });

describe("PublicationsSection (#218)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarises closed cards: the citation's start, the link, and whether it's on resumes", () => {
    render(<Harness />);
    expect(header(/^Rossi, S\. H\., Dombrowe, V\./)).toHaveTextContent("doi.org/10.1038/s41388-024-03270-3");
    expect(header(/A poster/)).toHaveTextContent("No link");
    expect(header(/A poster/)).toHaveTextContent("Not on resumes");
    expect(screen.getByText("In your own order. Drag an entry or use its arrows to move it.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by date" })).not.toBeInTheDocument();
  });

  it("shows how the citation looks, and makes words bold and italic with B, I and the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/A poster/));
    const box = screen.getByRole("textbox", { name: "Citation" });
    expect(box).toHaveAccessibleDescription(/In any citation style/);

    // "Dombrowe, V." in bold, with the B button.
    (box as HTMLTextAreaElement).setSelectionRange(0, "Dombrowe, V.".length);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(box).toHaveValue("**Dombrowe, V.** (2019). A poster.");

    // "poster" in italics, with Ctrl+I.
    const start = "**Dombrowe, V.** (2019). A ".length;
    (box as HTMLTextAreaElement).setSelectionRange(start, start + "poster".length);
    await user.keyboard("{Control>}i{/Control}");
    expect(box).toHaveValue("**Dombrowe, V.** (2019). A *poster*.");

    const preview = screen.getByText(/How it looks/).parentElement!;
    expect(within(preview).getByText("Dombrowe, V.").tagName).toBe("STRONG");
    expect(within(preview).getByText("poster").tagName).toBe("EM");
    await waitFor(() => expect(savePublication).toHaveBeenLastCalledWith(expect.objectContaining({ id: "u2", citation: "**Dombrowe, V.** (2019). A *poster*." })), {
      timeout: 2000,
    });
  });

  it("turns a bare DOI into its link, and switches a publication on for resumes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/A poster/));
    await user.type(screen.getByLabelText(/^Link/), "10.5555/12345678");
    await user.tab();
    expect(screen.getByLabelText(/^Link/)).toHaveValue("https://doi.org/10.5555/12345678");
    await user.click(screen.getByLabelText("Show on resumes"));
    await waitFor(() => expect(latest.publications[1]).toMatchObject({ link: "https://doi.org/10.5555/12345678", onResumes: true }));
    await waitFor(() => expect(savePublication).toHaveBeenLastCalledWith(expect.objectContaining({ id: "u2", onResumes: true })), { timeout: 2000 });
  });

  it("moves a publication with its arrows, in an order set by hand", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^Move “Dombrowe, V\. \(2019\)\. A poster\.” up$/ }));
    expect(reorderPublications).toHaveBeenCalledWith({ ids: ["u2", "u1"] });
    expect(latest.publications.map((entry) => entry.id)).toEqual(["u2", "u1"]);
  });
});
