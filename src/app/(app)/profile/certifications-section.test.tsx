import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CertificationItem, ProfileData } from "@/lib/profile";

import { reorderCertifications, saveCertification } from "./actions";
import { CertificationsSection } from "./certifications-section";

vi.mock("./actions", () => ({
  createCertification: vi.fn(),
  saveCertification: vi.fn(async () => ({ ok: true, data: null })),
  removeCertification: vi.fn(async () => ({ ok: true, data: null })),
  restoreCertification: vi.fn(),
  reorderCertifications: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const specialist: CertificationItem = {
  id: "c1",
  name: "Certified Accessibility Specialist",
  issuer: "Inclusive Design Institute",
  year: 2022,
  month: 6,
  expiryYear: 2028,
  expiryMonth: 6,
  credentialId: "IDI-20481",
  link: "https://verify.example.org/IDI-20481",
  onResumes: true,
};
const hidden: CertificationItem = { ...specialist, id: "c2", name: "First aid", issuer: "Red Cross", year: 2019, month: null, expiryYear: null, expiryMonth: null, credentialId: "", link: "", onResumes: false };

let latest: ProfileData;
function Harness() {
  const [state, setState] = useState<ProfileData>({
    basics: {} as ProfileData["basics"],
    skills: [],
    languages: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [specialist, hidden],
    publications: [],
    references: [],
    customSections: [],
    facts: [],
    photo: null,
  });
  useEffect(() => {
    latest = state;
  });
  return <CertificationsSection profile={state} update={(change) => setState(change)} />;
}

const header = (name: RegExp | string) => screen.getByRole("button", { name, expanded: false });

describe("CertificationsSection (#293)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("summarises closed cards: the name, the issuer, when it was obtained, and whether it's on resumes", () => {
    render(<Harness />);
    expect(header(/^Certified Accessibility Specialist/)).toHaveTextContent("Inclusive Design Institute");
    expect(header(/^Certified Accessibility Specialist/)).toHaveTextContent("Jun 2022");
    expect(header(/^First aid/)).toHaveTextContent("Not on resumes");
    expect(screen.getByText("In your own order. Drag an entry or use its arrows to move it.")).toBeInTheDocument();
  });

  it("edits a certification's fields and saves them", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(header(/^First aid/));
    expect(screen.getByRole("textbox", { name: "Certification" })).toHaveValue("First aid");
    expect(screen.getByRole("textbox", { name: "Issued by" })).toHaveValue("Red Cross");
    await user.type(screen.getByLabelText(/^Credential ID/), "RC-1");
    await user.type(screen.getByRole("textbox", { name: "Expires year" }), "2027");
    await user.click(screen.getByLabelText("Show on resumes"));
    await waitFor(() => expect(latest.certifications[1]).toMatchObject({ credentialId: "RC-1", expiryYear: 2027, onResumes: true }));
    await waitFor(() => expect(saveCertification).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c2", credentialId: "RC-1", expiryYear: 2027, onResumes: true })), {
      timeout: 2000,
    });
  });

  it("moves a certification with its arrows, in an order set by hand", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /^Move “First aid” up$/ }));
    expect(reorderCertifications).toHaveBeenCalledWith({ profileId: "", ids: ["c2", "c1"] });
    expect(latest.certifications.map((entry) => entry.id)).toEqual(["c2", "c1"]);
  });
});
