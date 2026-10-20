"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition, type FormEvent } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/cn";

import { signIn, signInWithForm } from "./actions";
import { loginMessages } from "./messages";

/**
 * The password-only sign-in form (PRD AUTH-1, AUTH-4). With scripts, `submit`
 * signs in and the form's own submit never happens. Before they've run, the
 * browser posts the form to `signInWithForm` instead (#187).
 */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [remember, setRemember] = useState(false);
  const [posted, formAction] = useActionState(signInWithForm, null);
  const [error, setError] = useState<string | null>(posted?.error ?? null);
  const [pending, startTransition] = useTransition();

  function fail(message: string) {
    setError(message);
    input.current?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!password) return fail(loginMessages.empty);

    startTransition(async () => {
      const result = await signIn({ password, remember, next });
      if (!result.ok) return fail(result.error);
      toastResult(result);
      router.replace(result.data.redirectTo);
    });
  }

  return (
    <form
      action={formAction}
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-5"
    >
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Welcome back</h1>
        <p className="text-sm text-muted">Sign in to pick up where you left off.</p>
      </div>

      <div className="flex flex-col gap-[7px]">
        <div className="flex justify-between text-label text-muted">
          <label htmlFor="password">Password</label>
          <button
            type="button"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-controls="password"
            onClick={() => setVisible((shown) => !shown)}
            className="underline underline-offset-3 hover:text-ink"
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>
        <input
          ref={input}
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "password-error" : undefined}
          className={cn(controlClassName, "h-10 px-3")}
        />
        {error && (
          <p id="password-error" role="alert" className="text-meta text-error">
            {error}
          </p>
        )}
      </div>

      <Checkbox
        label="Keep me signed in for 30 days"
        name="remember"
        checked={remember}
        onChange={(event) => setRemember(event.target.checked)}
      />

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
