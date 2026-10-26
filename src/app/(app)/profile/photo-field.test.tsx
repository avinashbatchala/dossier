import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { ProfilePhoto } from "@/lib/photo";

import { removePhoto, savePhoto, setPhotoOnResumes } from "./actions";
import { PhotoField } from "./photo-field";

vi.mock("./actions", () => ({
  savePhoto: vi.fn(async () => ({ ok: true, data: null })),
  removePhoto: vi.fn(async () => ({ ok: true, data: null })),
  setPhotoOnResumes: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let latest: ProfilePhoto | null;
function Harness({ initial }: { initial: ProfilePhoto | null }) {
  const [photo, setPhoto] = useState(initial);
  useEffect(() => {
    latest = photo;
  });
  return <PhotoField photo={photo} onChange={setPhoto} />;
}

describe("PhotoField (#224)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers to add a photo, for resumes only", () => {
    render(<Harness initial={null} />);
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
    expect(screen.getByText(/never sent to the AI/)).toBeInTheDocument();
    expect(screen.getByLabelText("Photo file")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows the photo, and keeps it off resumes and on again", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ src: png, onResumes: true }} />);
    expect(screen.getByRole("img", { name: "Your photo" })).toHaveAttribute("src", png);
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show on resumes" }));
    expect(setPhotoOnResumes).toHaveBeenCalledWith({ onResumes: false });
    expect(latest).toEqual({ src: png, onResumes: false });
  });

  it("removes it with Undo, which puts it back as it was", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ src: png, onResumes: false }} />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(removePhoto).toHaveBeenCalled();
    expect(latest).toBeNull();
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();

    const [message, options] = vi.mocked(toast).mock.calls[0];
    expect(message).toBe("Removed your photo.");
    await options!.action!.onClick();
    expect(savePhoto).toHaveBeenCalledWith({ src: png, onResumes: false });
    expect(await screen.findByRole("img", { name: "Your photo" })).toBeInTheDocument();
  });

  it("puts the photo back when removing fails", async () => {
    vi.mocked(removePhoto).mockResolvedValueOnce({ ok: false, error: "Something went wrong." });
    const user = userEvent.setup();
    render(<Harness initial={{ src: png, onResumes: true }} />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(toast).toHaveBeenCalledWith("Something went wrong.");
    expect(latest).toEqual({ src: png, onResumes: true });
  });
});
