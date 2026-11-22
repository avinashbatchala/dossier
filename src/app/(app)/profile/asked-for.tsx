"use client";

import { ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useState, useTransition } from "react";

import { GapForm, type GapAnswer } from "@/components/gap-form";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { askedFor, askedNote, DEMAND_MIN_POSTINGS, type AskedFor, type Demand } from "@/lib/demand-count";
import { paidRoles, type ExperienceItem, type ProfileData } from "@/lib/profile";

import { roleLabel } from "../applications/[id]/meta";

import { addAskedSkill, hideAskedSkill, notHereAskedSkill } from "./actions";
import type { UpdateProfile } from "./skills-section";

/** The card lists this many gaps; the sheet this many skills (E33-3, design 8a and 8b). */
const CARD_GAPS = 3;
const SHEET_ASKS = 8;

/** What employers ask for, as the Profile page works with it (E33-3). */
export type AskedForState = {
  /** The postings counted. */
  postings: number;
  /** Most asked first, each covered or not, without the ones marked "I don't have this". */
  asks: AskedFor[];
  /** "Add": resolves to whether it went, so the form can close. */
  add: (name: string, answer: GapAnswer) => Promise<boolean>;
  /** "I don't have this", with Undo. */
  hide: (key: string) => void;
  /** The gap to ask a role about (E33-4): the top one not marked "Not here" for it, or null. */
  promptFor: (roleId: string) => AskedFor | null;
  /** "Not here" on a role's gap prompt, with Undo. */
  notHere: (roleId: string, key: string) => void;
};

/**
 * What employers ask for, worked out as the profile changes (E33-3): a skill
 * added under Skills is covered at once.
 */
export function useAskedFor({
  profileId,
  demand,
  hidden: initialHidden,
  notHere: initialNotHere,
  profile,
  update,
}: {
  profileId: string;
  demand: Demand;
  hidden: readonly string[];
  /** "{role id} {skill key}" for each "Not here". */
  notHere: readonly string[];
  profile: ProfileData;
  update: UpdateProfile;
}): AskedForState {
  const [hidden, setHidden] = useState(initialHidden);
  const [notHereKeys, setNotHereKeys] = useState(initialNotHere);
  const known = useMemo(() => [...profile.skills.map((skill) => skill.name), ...profile.languages.map((language) => language.name)], [profile.skills, profile.languages]);
  const asks = useMemo(() => askedFor(demand, { known, hidden }), [demand, known, hidden]);

  const add = async (name: string, { experienceId, did }: GapAnswer) => {
    const result = await addAskedSkill({ profileId, name, experienceId, did: did || undefined });
    if (!result.ok) {
      toast(result.error);
      return false;
    }
    const { skill, experienceId: linked, bullets } = result.data;
    update((current) => ({
      ...current,
      skills: current.skills.some((entry) => entry.id === skill.id) ? current.skills : [...current.skills, skill],
      experience: current.experience.map((role) =>
        role.id !== linked ? role : { ...role, skillIds: role.skillIds.includes(skill.id) ? role.skillIds : [...role.skillIds, skill.id], bullets: bullets ?? role.bullets },
      ),
    }));
    const role = linked ? profile.experience.find((entry) => entry.id === linked) : undefined;
    const where = role ? role.company.trim() || role.role.trim() : "";
    toast(where ? `Added “${skill.name}” to your profile, at ${where}.` : `Added “${skill.name}” to your skills. Attach it to a role under Experience to make it count.`);
    return true;
  };

  const hide = (key: string) => {
    setHidden((current) => [...current, key]);
    void hideAskedSkill({ profileId, key, hidden: true }).then((result) => {
      if (!toastResult(result).ok) return setHidden((current) => current.filter((entry) => entry !== key));
      toast("Noted. It won't come up here again for this profile.", {
        action: {
          label: "Undo",
          onClick: () => {
            setHidden((current) => current.filter((entry) => entry !== key));
            void hideAskedSkill({ profileId, key, hidden: false }).then(toastResult);
          },
        },
      });
    });
  };

  // Only the gaps the card shows: a prompt is about what employers ask most (E33-4).
  const promptFor = (roleId: string) =>
    demand.postings < DEMAND_MIN_POSTINGS ? null : (asks.filter((ask) => !ask.covered).slice(0, CARD_GAPS).find((ask) => !notHereKeys.includes(`${roleId} ${ask.key}`)) ?? null);

  const notHere = (roleId: string, key: string) => {
    const entry = `${roleId} ${key}`;
    setNotHereKeys((current) => [...current, entry]);
    void notHereAskedSkill({ profileId, roleId, key, on: true }).then((result) => {
      if (!toastResult(result).ok) return setNotHereKeys((current) => current.filter((kept) => kept !== entry));
      toast("Noted. It won't be asked about this role again.", {
        action: {
          label: "Undo",
          onClick: () => {
            setNotHereKeys((current) => current.filter((kept) => kept !== entry));
            void notHereAskedSkill({ profileId, roleId, key, on: false }).then(toastResult);
          },
        },
      });
    });
  };

  return { postings: demand.postings, asks, add, hide, promptFor, notHere };
}

/** A skill employers ask for, with Add and its form on a gap. */
function AskRow({
  ask,
  postings,
  roles,
  adding,
  onAdding,
  state,
  variant,
}: {
  ask: AskedFor;
  postings: number;
  roles: { id: string; label: string }[];
  adding: boolean;
  onAdding: (adding: boolean) => void;
  state: AskedForState;
  variant: "card" | "sheet";
}) {
  const share = Math.max(4, Math.round((ask.count / Math.max(postings, 1)) * 100));
  return (
    <li className={cn("flex flex-col", variant === "card" ? "gap-0.5 border-t border-line py-2.5" : "gap-1.5 border-b border-line py-3")}>
      <div className="flex items-center gap-2.5">
        {variant === "sheet" && (
          <span aria-hidden="true" className={cn("w-3 flex-none text-center text-xs", ask.covered ? "text-success" : "font-semibold text-warning")}>
            {ask.covered ? "✓" : "–"}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">
            {ask.name}
            {variant === "sheet" && <span className="sr-only">{ask.covered ? ", in your profile" : ", not in your profile"}</span>}
          </span>
          {variant === "card" && <span className="truncate text-label text-muted">{askedNote(ask)}</span>}
        </span>
        {variant === "sheet" && (
          <span className="flex-none text-label text-muted tabular-nums">
            {ask.count} of {postings}
          </span>
        )}
        {!ask.covered && (
          <button
            type="button"
            aria-expanded={adding}
            onClick={() => onAdding(!adding)}
            className="flex-none rounded-control border border-line-strong bg-card px-2.5 py-1 text-label font-medium hover:bg-hover"
          >
            Add <span className="sr-only">{ask.name}</span>
          </button>
        )}
      </div>
      {variant === "sheet" && (
        <span aria-hidden="true" className="ml-[22px] h-1 overflow-hidden rounded-full bg-track">
          <span className={cn("block h-full rounded-full", ask.covered ? "bg-success" : "bg-warning")} style={{ width: `${share}%` }} />
        </span>
      )}
      {adding && (
        <GapForm
          skill={ask.name}
          roles={roles}
          onAdd={async (answer) => {
            if (await state.add(ask.name, answer)) onAdding(false);
          }}
          onKnown={() => {
            onAdding(false);
            state.hide(ask.key);
          }}
          onCancel={() => onAdding(false)}
          className="mt-2"
        />
      )}
    </li>
  );
}

/**
 * "Asked for, not in your profile" (E33-3, design 8a): the gaps most
 * postings ask for, each with Add. Its header opens "What employers ask
 * for" (8b), a 400 px sheet on the right with the most asked skills and how
 * often each comes up. Until there are enough postings, it says so.
 */
export function AskedForCard({ state, profile, profileName }: { state: AskedForState; profile: ProfileData; profileName: string }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const roles = paidRoles(profile.experience).map((entry) => ({ id: entry.id, label: roleLabel(entry) }));
  const row = (ask: AskedFor, variant: "card" | "sheet") => (
    <AskRow
      key={ask.key}
      ask={ask}
      postings={state.postings}
      roles={roles}
      adding={adding === `${variant}:${ask.key}`}
      onAdding={(on) => setAdding(on ? `${variant}:${ask.key}` : null)}
      state={state}
      variant={variant}
    />
  );

  if (state.postings < DEMAND_MIN_POSTINGS) {
    return (
      <section aria-label="What employers ask for" className="rounded-card border border-line-card bg-card px-4 py-3.5">
        <h2 className="text-sm font-medium">What employers ask for</h2>
        <p className="mt-1 text-label text-pretty text-muted">
          Shows once {DEMAND_MIN_POSTINGS} postings you saved or applied for are scored for this profile. {state.postings === 0 ? "None yet." : `${state.postings} so far.`}
        </p>
      </section>
    );
  }

  const gaps = state.asks.filter((ask) => !ask.covered).slice(0, CARD_GAPS);
  return (
    <section aria-labelledby="asked-for-title" className="rounded-card border border-line-card bg-card px-4 pt-3.5 pb-1.5">
      <Dialog.Root modal={false} open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className="-mx-2 -mt-1.5 flex w-[calc(100%+16px)] items-start gap-2 rounded-control px-2 py-1.5 text-left hover:bg-hover">
          <span className="flex min-w-0 flex-1 flex-col">
            <span id="asked-for-title" className="text-sm font-medium">
              Asked for, not in your profile
            </span>
            <span className="text-label text-muted">From your applications and saved postings</span>
          </span>
          <ChevronRight size={16} aria-hidden="true" className="mt-0.5 flex-none text-muted" />
          <span className="sr-only">: see what employers ask for</span>
        </Dialog.Trigger>
        <Dialog.Content className="fixed inset-y-0 right-0 z-40 flex w-[400px] max-w-full flex-col overflow-y-auto border-l border-line-card bg-surface px-6 py-6 shadow-menu focus:outline-none">
          <Dialog.Title className="pr-8 text-[15px] font-medium">What employers ask for</Dialog.Title>
          <Dialog.Description className="mt-1 text-label text-pretty text-muted">
            From {state.postings} postings you saved or applied for{profileName ? `, for ${profileName}` : ""}. The bar is how often it comes up. ✓ means your profile covers it.
          </Dialog.Description>
          <Dialog.Close aria-label="Close" className="absolute top-4 right-4 grid size-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
            <X size={16} aria-hidden="true" />
          </Dialog.Close>
          <ul className="mt-4 flex flex-col">{state.asks.slice(0, SHEET_ASKS).map((ask) => row(ask, "sheet"))}</ul>
          <p className="mt-4 text-label text-pretty text-muted">“Add” asks where you used it, as on an application. “I don&apos;t have this” hides it from here for this profile.</p>
        </Dialog.Content>
      </Dialog.Root>
      {gaps.length > 0 ? (
        <ul className="mt-2 flex flex-col">{gaps.map((ask) => row(ask, "card"))}</ul>
      ) : (
        <p className="mt-2 border-t border-line py-2.5 text-label text-muted">Your profile covers what they ask for most.</p>
      )}
    </section>
  );
}

/** "Ledgerly, Adyen and Finch Ledger", "Ledgerly, Adyen and 3 others", or "5 postings" when none is named. */
export function askers(ask: Pick<AskedFor, "count" | "companies">): string {
  const names = ask.companies;
  if (names.length === 0) return ask.count === 1 ? "A posting" : `${ask.count} postings`;
  if (names.length === 1) return names[0];
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/**
 * The gap prompt inside the most recent role (E33-4, design 8a): a template,
 * never AI, for the top gap employers ask about. Add a line writes one into
 * the role and links the skill; Not here is kept for this role and gap.
 */
export function GapPrompt({ role, ask, state }: { role: ExperienceItem; ask: AskedFor; state: AskedForState }) {
  const [writing, setWriting] = useState(false);
  const [line, setLine] = useState("");
  const [pending, startTransition] = useTransition();
  const where = role.company.trim() || role.role.trim() || "this role";
  const add = () =>
    startTransition(async () => {
      if (await state.add(ask.name, { experienceId: role.id, did: line.trim() })) {
        setWriting(false);
        setLine("");
      }
    });
  return (
    <div role="group" aria-label={`A question about ${ask.name}`} className="flex flex-col gap-3 rounded-control border border-dashed border-warning-line bg-warning-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-[1_1_320px] text-meta text-pretty">
          <span className="font-medium">
            {askers(ask)} {ask.count === 1 && ask.companies.length <= 1 ? "asks" : "ask"} about {ask.name}.
          </span>{" "}
          <span className="text-muted">Did anything at {where} touch it? Only add it if it&apos;s true.</span>
        </p>
        {!writing && (
          <span className="flex flex-none items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setWriting(true)}>
              Add a line
            </Button>
            <Button variant="text" size="sm" onClick={() => state.notHere(role.id, ask.key)}>
              Not here
            </Button>
          </span>
        )}
      </div>
      {writing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (line.trim() && !pending) add();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setWriting(false);
          }}
        >
          <Input
            label={`What you did with ${ask.name} at ${where}`}
            value={line}
            onChange={(event) => setLine(event.target.value)}
            maxLength={500}
            autoFocus
            className="min-w-0 flex-[1_1_320px]"
          />
          <Button type="submit" size="sm" aria-disabled={pending || !line.trim() || undefined}>
            Add the line
          </Button>
          <Button variant="text" size="sm" onClick={() => setWriting(false)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
