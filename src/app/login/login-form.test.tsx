import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toastResult } from "@/components/toast";

import { signIn } from "./actions";
import { LoginForm } from "./login-form";
import { loginMessages } from "./messages";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("./actions", () => ({ signIn: vi.fn(), signInWithForm: vi.fn() }));
vi.mock("@/components/toast", () => ({ toastResult: vi.fn() }));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.mocked(signIn).mockReset();
    replace.mockReset();
  });

  it("has a single autofocused password field and no username", () => {
    render(<LoginForm />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByRole("checkbox", { name: "Keep me signed in for 30 days" })).not.toBeChecked();
  });

  it("names its fields, so the browser can post them before scripts run", () => {
    const { container } = render(<LoginForm next="/profile" />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("name", "password");
    expect(screen.getByRole("checkbox", { name: "Keep me signed in for 30 days" })).toHaveAttribute("name", "remember");
    expect(container.querySelector('input[type="hidden"][name="next"]')).toHaveValue("/profile");
  });

  it("shows and hides the password", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("asks for the password on an empty submit without calling the server", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent(loginMessages.empty);
    expect(screen.getByLabelText("Password")).toBeInvalid();
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows the server's error, and clears it when typing again", async () => {
    const user = userEvent.setup();
    vi.mocked(signIn).mockResolvedValue({ ok: false, error: loginMessages.wrong });
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Password"), "hunter2{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(loginMessages.wrong);
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(loginMessages.wrong);

    await user.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows 'Signing in…' while waiting, then welcomes the user and goes to the next page", async () => {
    const user = userEvent.setup();
    let finish!: (value: Awaited<ReturnType<typeof signIn>>) => void;
    vi.mocked(signIn).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<LoginForm next="/profile" />);

    await user.click(screen.getByRole("checkbox", { name: "Keep me signed in for 30 days" }));
    await user.type(screen.getByLabelText("Password"), "correct horse{Enter}");
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(signIn).toHaveBeenCalledWith({ password: "correct horse", remember: true, next: "/profile" });

    const result = { ok: true as const, data: { redirectTo: "/profile" }, toast: "Welcome back, Jane." };
    finish(result);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/profile"));
    expect(toastResult).toHaveBeenCalledWith(result);
  });
});
