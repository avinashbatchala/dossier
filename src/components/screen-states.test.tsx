import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ApplicationNotFound from "@/app/(app)/applications/[id]/not-found";
import AppError from "@/app/(app)/error";
import InboxLoading from "@/app/(app)/inbox/loading";
import NewApplicationError from "@/app/(app)/new/error";
import UsageLoading from "@/app/(app)/usage/loading";
import NotFound from "@/app/not-found";

import { ScreenSkeleton } from "./screen-skeleton";

// E11-4: no dead ends. Every state says what happened and what to do next.
describe("error screens", () => {
  it("say it didn't load, offer Try again and a way elsewhere, and point to the log", async () => {
    const retry = vi.fn();
    render(<AppError error={Object.assign(new Error("secret detail"), { digest: "123abc" })} retry={retry} />);
    expect(screen.getByRole("heading", { level: 1, name: "This screen didn't load" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing you saved is lost/)).toBeInTheDocument();
    expect(screen.getByText("123abc")).toBeInTheDocument();
    // The error's own message stays out of sight.
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open your applications" })).toHaveAttribute("href", "/applications");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("reassure that a pasted posting is kept", () => {
    render(<NewApplicationError error={new Error("x")} retry={() => {}} />);
    expect(screen.getByText(/still kept in this tab/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/");
  });
});

describe("not-found screens", () => {
  it("lead back to Applications from an unknown application", () => {
    render(<ApplicationNotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn't find that application" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Applications" })).toHaveAttribute("href", "/applications");
  });

  it("lead to the dashboard from an unknown address", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "There's no page here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/");
  });
});

describe("ScreenSkeleton", () => {
  it("tells screen readers what's loading, and hides the shapes", () => {
    const { container } = render(<ScreenSkeleton label="Loading your profile…" variant="form" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your profile…");
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("names the screen that's loading, not the dashboard", () => {
    const { unmount } = render(<InboxLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your inbox…");
    unmount();
    render(<UsageLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading usage…");
  });
});
