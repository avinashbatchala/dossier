"use client";

import { useState, useTransition, type ReactNode } from "react";

import { SavedIndicator } from "@/components/saved-indicator";
import { toast, toastResult } from "@/components/toast";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RemovableChip, ToggleChip } from "@/components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { Stepper } from "@/components/ui/stepper";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ApplicationStatus } from "@/generated/prisma/enums";
import { useAutosave } from "@/hooks/use-autosave";
import { STATUSES, statusInfo } from "@/lib/status";

import { demoAction } from "./actions";
import { StatusChangeDemo, type DemoApplication } from "./status-change-demo";

const VARIANTS: ButtonVariant[] = [
  "primary",
  "secondary",
  "text",
  "danger-text",
  "danger-outline",
  "danger",
];

const NEW_STEPS = ["Paste the posting", "Check the details", "Tailored documents"];
const READING_STEPS = [
  "Reading the posting",
  "Picking out the role, company and requirements",
  "Comparing it with your profile",
];

/** Stands in for a Server Action: slow, and failing when the text contains "fail". */
async function fakeSave(headline: string) {
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (headline.toLowerCase().includes("fail")) {
    return { ok: false as const, error: "The server said no: the headline contains “fail”." };
  }
  return { ok: true as const, data: null };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-8">
      <h2 className="font-serif text-section">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function Gallery({ application }: { application: DemoApplication | null }) {
  const [skills, setSkills] = useState(["Figma", "Design systems", "User research"]);
  const [attached, setAttached] = useState(["Figma"]);
  const [strict, setStrict] = useState(true);
  const [creativity, setCreativity] = useState<"faithful" | "balanced" | "expressive">("balanced");
  const [view, setView] = useState<"board" | "table">("board");
  const [status, setStatus] = useState<ApplicationStatus>(ApplicationStatus.INTERVIEW);
  const [newStep, setNewStep] = useState(1);
  const [readingStep, setReadingStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [headline, setHeadline] = useState("Senior product designer");
  const autosave = useAutosave(headline, fakeSave);

  const runDemoAction = (outcome: "success" | "error" | "crash") =>
    startTransition(async () => {
      toastResult(await demoAction({ outcome }));
    });

  return (
    <main className="mx-auto flex max-w-[960px] flex-col gap-10 px-10 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-title">UI primitives</h1>
        <p className="text-lead text-muted">
          Every building block in every state. This page only exists in development.
        </p>
      </header>

      <Section title="Type and colour">
        <Row label="Titles">
          <span className="font-serif text-title">Page title</span>
          <span className="font-serif text-section">Section title</span>
        </Row>
        <Row label="Text">
          <span className="text-field">Field 14.5</span>
          <span className="text-sm">Body 14</span>
          <span className="text-control">Control 13.5</span>
          <span className="text-meta text-muted">Meta 13 muted</span>
          <span className="text-label text-muted">Label 12.5 muted</span>
          <span className="font-mono text-sm">Plex Mono</span>
          <span className="font-plex-sans text-sm">Plex Sans</span>
          <span className="font-garamond text-sm">EB Garamond</span>
          <span className="font-serif text-sm italic">Newsreader italic</span>
        </Row>
        <Row label="Feedback">
          <span className="text-sm text-success">Success</span>
          <span className="text-sm text-danger">Danger</span>
          <span className="text-sm text-error">Error</span>
          <span className="rounded-md bg-warning-surface px-2 py-[3px] text-xs text-warning">
            Warning chip
          </span>
          <span className="rounded-md bg-flash px-2 py-[3px] text-xs">Flash</span>
          <span className="text-sm text-faint">Faint (disabled only)</span>
        </Row>
      </Section>

      <Section title="Buttons">
        {(["md", "sm"] as const).map((size) => (
          <Row key={size} label={`Size ${size}`}>
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {variant}
              </Button>
            ))}
          </Row>
        ))}
        <Row label="Disabled">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant}
            </Button>
          ))}
        </Row>
        <Row label="aria-disabled (still focusable and clickable)">
          <Button aria-disabled>Read the posting →</Button>
        </Row>
      </Section>

      <Section title="Form controls">
        <div className="grid grid-cols-2 gap-x-[18px] gap-y-5">
          <Input label="Full name" placeholder="Jane Doe" />
          <Input label="Email" hint="Shown at the top of your resume." defaultValue="jane@example.com" />
          <Input label="Website" error="Enter a full address, like https://example.com." defaultValue="example.com" />
          <Input label="Date of birth" disabled defaultValue="12 March 1990" />
          <Textarea
            className="col-span-2"
            label="Job posting"
            rows={4}
            placeholder="Paste the full posting here: title, company, requirements, the lot."
          />
          <Select label="Paper size" defaultValue="A4">
            <option value="A4">A4</option>
            <option value="Letter">US Letter</option>
          </Select>
          <Select label="Date format" error="Pick a date format." defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            <option>27 September 2026</option>
          </Select>
        </div>
        <Row label="Checkboxes">
          <Checkbox label="Keep me signed in for 30 days" />
          <Checkbox label="Show my age on resumes" defaultChecked hint="Many advise leaving it out." />
          <Checkbox label="Disabled" disabled />
          <Checkbox label="With an error" error="You need to confirm this." />
        </Row>
      </Section>

      <Section title="Toggles and segmented controls">
        <Card className="flex flex-col divide-y divide-line py-2">
          <Toggle
            className="py-4"
            label="Never invent experience"
            description="Drafts may only use facts from your profile."
            checked={strict}
            onCheckedChange={setStrict}
          />
          <Toggle className="py-4" label="Off" description="An unchecked toggle." />
          <Toggle className="py-4" label="Disabled" disabled defaultChecked />
        </Card>
        <Row label="Segmented, md and sm">
          <SegmentedControl
            aria-label="View"
            options={[
              { value: "board", label: "Board" },
              { value: "table", label: "Table" },
            ]}
            value={view}
            onValueChange={setView}
          />
          <SegmentedControl
            aria-label="Creativity"
            size="sm"
            options={[
              { value: "faithful", label: "Faithful" },
              { value: "balanced", label: "Balanced" },
              { value: "expressive", label: "Expressive" },
            ]}
            value={creativity}
            onValueChange={setCreativity}
          />
          <SegmentedControl
            aria-label="Disabled example"
            disabled
            options={[
              { value: "a", label: "Disabled" },
              { value: "b", label: "Control" },
            ]}
            defaultValue="a"
          />
        </Row>
      </Section>

      <Section title="Chips">
        <Row label="Removable, with meta">
          {skills.map((skill, index) => (
            <RemovableChip
              key={skill}
              meta={index === 0 ? "2 roles" : undefined}
              removeLabel={`Remove ${skill}`}
              onRemove={() => setSkills((all) => all.filter((s) => s !== skill))}
            >
              {skill}
            </RemovableChip>
          ))}
          {skills.length === 0 && (
            <Button variant="text" onClick={() => setSkills(["Figma", "Design systems", "User research"])}>
              Reset
            </Button>
          )}
        </Row>
        <Row label="Toggle (skill chips get a ✓)">
          {["Figma", "Design systems", "User research"].map((skill) => (
            <ToggleChip
              key={skill}
              check
              selected={attached.includes(skill)}
              onClick={() =>
                setAttached((all) =>
                  all.includes(skill) ? all.filter((s) => s !== skill) : [...all, skill],
                )
              }
            >
              {skill}
            </ToggleChip>
          ))}
          <ToggleChip selected={false} disabled>
            Disabled
          </ToggleChip>
        </Row>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="resume">
          <TabsList aria-label="Document">
            <TabsTrigger value="resume">Resume</TabsTrigger>
            <TabsTrigger value="letter">Cover letter</TabsTrigger>
            <TabsTrigger value="posting">Job posting · 5/7 match</TabsTrigger>
            <TabsTrigger value="disabled" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="resume" className="pt-4 text-sm">The tailored resume.</TabsContent>
          <TabsContent value="letter" className="pt-4 text-sm">The cover letter.</TabsContent>
          <TabsContent value="posting" className="pt-4 text-sm">The job posting.</TabsContent>
        </Tabs>
        <Tabs defaultValue="themes" className="max-w-[360px]">
          <TabsList variant="segmented" aria-label="Theme panel">
            <TabsTrigger value="themes">Themes</TabsTrigger>
            <TabsTrigger value="customize">Customize</TabsTrigger>
          </TabsList>
          <TabsContent value="themes" className="pt-4 text-sm">Built-in and saved themes.</TabsContent>
          <TabsContent value="customize" className="pt-4 text-sm">The theme builder.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Dropdown menu and status dots">
        <Row label="Status menu">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-[9px] rounded-full border border-line-control bg-card px-3.5 py-[9px] text-sm font-medium hover:border-line-strong">
              <StatusDot status={status} />
              {statusInfo(status).label}
              <span aria-hidden="true" className="text-[10px] text-muted">
                ▼
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Move this application to</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={status}
                onValueChange={(value) => setStatus(value as ApplicationStatus)}
              >
                {STATUSES.map(({ value, label }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <StatusDot status={value} />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Archive</DropdownMenuItem>
              <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
        <Row label="Status dots">
          {STATUSES.map(({ value, label }) => (
            <span key={value} className="inline-flex items-center gap-2 text-sm">
              <StatusDot status={value} />
              {label}
            </span>
          ))}
        </Row>
      </Section>

      <Section title="Stepper and progress steps">
        <Row label="Stepper">
          <Stepper steps={NEW_STEPS} current={newStep} />
          <Button variant="text" onClick={() => setNewStep((step) => (step + 1) % (NEW_STEPS.length + 1))}>
            Next step
          </Button>
        </Row>
        <Card className="flex flex-col gap-[22px] px-9 py-10">
          <div className="font-serif text-section">Reading the posting…</div>
          <ProgressSteps steps={READING_STEPS} current={readingStep} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-meta text-muted">This can take a little longer on a local model.</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReadingStep((step) => (step + 1) % (READING_STEPS.length + 1))}
            >
              Advance
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Status changes">
        <Row label="The latest application, changed through the shared setStatus action (with Undo)">
          <StatusChangeDemo application={application} />
        </Row>
      </Section>

      <Section title="Toasts">
        <Row label="From client code (a new toast replaces the current one)">
          <Button variant="secondary" onClick={() => toast("Added “Figma” to your skills.")}>
            Show a toast
          </Button>
          <Button variant="secondary" onClick={() => toast("An interview! You've got this.")}>
            Show another
          </Button>
        </Row>
        <Row label="From a Server Action result">
          <Button variant="secondary" disabled={pending} onClick={() => runDemoAction("success")}>
            Action succeeds
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => runDemoAction("error")}>
            Action reports an error
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => runDemoAction("crash")}>
            Action crashes
          </Button>
        </Row>
      </Section>

      <Section title="Autosave">
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-lead font-medium">Basics</div>
            <SavedIndicator status={autosave.status} savedAt={autosave.savedAt} />
          </div>
          <Input
            label="Headline"
            hint="Saved 500 ms after you stop typing, and when you leave the field. Include “fail” to see a failed save."
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
            onBlur={autosave.flush}
          />
        </Card>
      </Section>

      <Section title="Cards">
        <div className="grid grid-cols-2 gap-5">
          <Card>
            <div className="text-lead font-medium">Default card</div>
            <p className="mt-2 text-sm text-muted">28px padding, 14px radius, hairline border.</p>
          </Card>
          <Card padding="none" className="overflow-hidden">
            <div className="border-b border-line px-7 py-4 text-sm font-medium">padding=&quot;none&quot;</div>
            <div className="px-7 py-4 text-sm text-muted">Spacing is up to the content.</div>
          </Card>
        </div>
      </Section>
    </main>
  );
}
