"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { toast } from "@/components/toast";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

const COULD_NOT_SAVE =
  "Couldn't save your changes. They're still on this page, and saving will try again when you edit or leave the field.";

type AutosaverOptions<T> = {
  /** Persists a value. A Server Action's `{ ok: false, error }` counts as a failure. */
  save: (value: T) => Promise<unknown>;
  delay: number;
  onStatus: (status: AutosaveStatus, savedAt?: Date) => void;
  onFailure: (message: string) => void;
};

function failureMessage(result: unknown): string | null {
  if (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    result.ok === false &&
    "error" in result &&
    typeof result.error === "string"
  ) {
    return result.error;
  }
  return null;
}

/**
 * The autosave logic without React. Changes are debounced, and only one save
 * runs at a time: changes made during a save are coalesced and sent after it,
 * so the newest value is always the one saved last and responses can't
 * arrive out of order. A failed save is retried once.
 */
function createAutosaver<T>({ save: initialSave, delay, onStatus, onFailure }: AutosaverOptions<T>) {
  let save = initialSave;
  let pending: { value: T } | null = null; // changed, not yet sent
  let failed: { value: T } | null = null; // sent, not saved; retried on the next flush
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;

  async function attempt(value: T): Promise<string | null> {
    try {
      return failureMessage(await save(value));
    } catch {
      return COULD_NOT_SAVE;
    }
  }

  async function run(value: T) {
    saving = true;
    let failure = await attempt(value);
    // Retry once, unless a newer change has replaced this value anyway.
    if (failure !== null && !pending) failure = await attempt(value);
    saving = false;

    if (pending) {
      // A newer change arrived during the save: send it now, unless its debounce is still running.
      if (timer === undefined) flush();
    } else if (failure !== null) {
      failed = { value };
      onStatus("error");
      onFailure(failure);
    } else {
      onStatus("saved", new Date());
    }
  }

  /** Records a change; it's saved once no further change comes for `delay` ms. */
  function change(value: T) {
    pending = { value };
    failed = null;
    onStatus("saving");
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  /** Saves the latest change now instead of waiting for the debounce. */
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (saving) return; // run() sends it when the current save finishes
    const next = pending ?? failed;
    pending = null;
    failed = null;
    if (next) {
      onStatus("saving");
      void run(next.value);
    }
  }

  /** Uses a new save function from now on, e.g. one that closes over newer props. */
  function setSave(next: (value: T) => Promise<unknown>) {
    save = next;
  }

  return { change, flush, setSave };
}

/**
 * Saves `value` automatically, `delay` ms after it stops changing, for forms
 * without a Save button (PRD PRO-10). Typing is never blocked.
 *
 * Pending changes are also saved when the page is hidden or closed and when
 * the component unmounts (e.g. on navigation); call `flush` from `onBlur` to
 * save when the user leaves a field. When a save fails twice, an error toast
 * appears and the value stays in the form.
 *
 *     const { status, savedAt, flush } = useAutosave(basics, saveBasics);
 *     <form onBlur={flush}>…</form>
 *     <SavedIndicator status={status} savedAt={savedAt} />
 */
export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<unknown>,
  delay = 500,
): { status: AutosaveStatus; savedAt: Date | null; flush: () => void } {
  const [state, setState] = useState<{ status: AutosaveStatus; savedAt: Date | null }>({
    status: "idle",
    savedAt: null,
  });

  const [saver] = useState(() =>
    createAutosaver<T>({
      save,
      delay,
      onStatus: (status, savedAt) =>
        setState((previous) => ({ status, savedAt: savedAt ?? previous.savedAt })),
      onFailure: toast,
    }),
  );

  // Always call the latest `save`, without restarting the autosaver.
  useLayoutEffect(() => {
    saver.setSave(save);
  });

  // Save changes, but not the value the form started with.
  const lastSeen = useRef(value);
  useEffect(() => {
    if (Object.is(lastSeen.current, value)) return;
    lastSeen.current = value;
    saver.change(value);
  }, [saver, value]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") saver.flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", saver.flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", saver.flush);
      saver.flush(); // leaving the page, e.g. navigating to another screen
    };
  }, [saver]);

  return { status: state.status, savedAt: state.savedAt, flush: saver.flush };
}
