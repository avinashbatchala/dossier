"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button, buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { nextSetupStep, previousSetupStep, SETUP_RAIL, SETUP_STEPS, setupHref, type SetupStep } from "@/lib/setup-guide";

import { saveSetupGuide } from "./actions";

/**
 * The setup guide's page (E21): the steps, the step on screen, and Back and
 * Continue. Continue says Skip until the step is done. Each step is
 * remembered as it opens, and Done or "Leave setup" finishes the guide.
 */
export function SetupFrame({
  step,
  title,
  lead,
  complete,
  children,
}: {
  step: SetupStep;
  title: string;
  lead?: ReactNode;
  /** The step is set up, so the guide can go on rather than skip it. */
  complete: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  useEffect(() => {
    void saveSetupGuide({ step, finished: step === "done" });
  }, [step]);

  const leave = async () => {
    await saveSetupGuide({ step, finished: true });
    router.push("/");
  };
  const at = SETUP_STEPS.indexOf(step);
  const next = nextSetupStep(step);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-8 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandMark className="size-8" />
          <span className="font-serif text-[22px] font-medium">Dossier</span>
        </div>
        {step !== "done" && (
          <Button variant="text" size="sm" onClick={() => void leave()}>
            Leave setup
          </Button>
        )}
      </header>

      {step !== "start" && step !== "done" && (
        <nav aria-label="Setup steps">
          <ol className="flex flex-wrap gap-x-1 gap-y-2">
            {SETUP_RAIL.map((entry, index) => {
              const position = SETUP_STEPS.indexOf(entry.step);
              return (
                <li key={entry.step}>
                  <Link
                    href={setupHref(entry.step)}
                    aria-current={entry.step === step ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-meta text-muted hover:bg-hover hover:text-ink",
                      entry.step === step && "bg-selected font-medium text-ink hover:bg-selected",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-6 place-items-center rounded-full border border-line-strong text-xs tabular-nums",
                        position < at && "border-primary bg-primary text-on-primary",
                        entry.step === step && "border-ink",
                      )}
                    >
                      {index + 1}
                    </span>
                    {entry.name}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <main id="main" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-[34px] leading-tight font-medium tracking-[-0.01em]">{title}</h1>
          {lead && <div className="max-w-[640px] text-[15px] leading-relaxed text-pretty text-muted">{lead}</div>}
        </div>
        {children}
      </main>

      {step !== "start" && step !== "done" && (
        <footer className="flex items-center justify-between gap-3 border-t border-line pt-5">
          <Link href={setupHref(previousSetupStep(step))} className={buttonClassName("text")}>
            ← Back
          </Link>
          {complete ? (
            <Link href={setupHref(next)} className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              Continue →
            </Link>
          ) : (
            <Link href={setupHref(next)} className={buttonClassName("secondary")}>
              Skip this step →
            </Link>
          )}
        </footer>
      )}
    </div>
  );
}
