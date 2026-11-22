import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { dismissAnnouncement } from "@/lib/announcements/actions";
import type { Announcement } from "@/lib/announcements/contract";

import { AnnouncementNotice } from "./announcement-notice";

vi.mock("@/lib/announcements/actions", () => ({ dismissAnnouncement: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const announcement = (changes: Partial<Announcement> = {}): Announcement => ({
  id: "ann_1",
  severity: "info",
  title: "Dossier is moving",
  body: "The website has a new address.",
  link: null,
  minVersion: null,
  maxVersion: null,
  publishedAt: "2026-11-01T09:00:00Z",
  expiresAt: null,
  ...changes,
});

const renderNotice = (notice = announcement()) =>
  render(
    <>
      <main id="main" tabIndex={-1}>
        The page
      </main>
      <AnnouncementNotice announcement={notice} />
    </>,
  );

beforeEach(() => vi.clearAllMocks());

describe("AnnouncementNotice (E18-3)", () => {
  it("shows the title and the text", () => {
    renderNotice();
    const notice = screen.getByRole("region", { name: "Dossier is moving" });
    expect(notice).toHaveTextContent("The website has a new address.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says what kind of notice it is in words", () => {
    for (const [severity, word] of [["security", "Security notice"], ["important", "Important"], ["info", "From Dossier"]] as const) {
      const { unmount } = renderNotice(announcement({ severity }));
      expect(screen.getByText(word)).toBeInTheDocument();
      unmount();
    }
  });

  it("announces a security notice at once, and others politely", () => {
    const { unmount } = renderNotice(announcement({ severity: "security" }));
    expect(screen.getByRole("alert")).toContainElement(screen.getByRole("region"));
    unmount();
    renderNotice();
    expect(screen.getByRole("status")).toContainElement(screen.getByRole("region"));
  });

  it("shows HTML and Markdown as the plain text they are", () => {
    renderNotice(announcement({ title: "<b>Bold</b>", body: '**Sign in** <a href="https://evil.example">here</a>\n<img src=x onerror=alert(1)>' }));
    expect(screen.getByRole("heading", { name: "<b>Bold</b>" })).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveTextContent('**Sign in** <a href="https://evil.example">here</a>');
    expect(screen.getByRole("region").querySelector("img, b, strong")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps line breaks in the text", () => {
    renderNotice(announcement({ body: "One.\nTwo." }));
    expect(screen.getByText(/One\./).className).toContain("whitespace-pre-line");
  });

  it("opens its link in a new tab, and says so", () => {
    renderNotice(announcement({ link: { label: "What's new", url: "https://example.org/news" } }));
    const link = screen.getByRole("link", { name: "What's new (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "https://example.org/news");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("goes with Dismiss, and focus moves to the page", async () => {
    const user = userEvent.setup();
    renderNotice();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismissAnnouncement).toHaveBeenCalledWith({ id: "ann_1" });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("comes back when that isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(dismissAnnouncement).mockResolvedValueOnce({ ok: false, error: "You seem to be offline." });
    renderNotice();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(toast).toHaveBeenCalledWith("You seem to be offline.");
    expect(screen.getByRole("region", { name: "Dossier is moving" })).toBeInTheDocument();
  });
});
