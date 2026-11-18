"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

import { useSidebarCollapsed } from "../sidebar-frame";
import { jumpSearch } from "./actions";
import type { JumpGroup, JumpResult } from "./jump-search";

/** How long typing pauses before Jump to asks the server. */
const SEARCH_DELAY_MS = 120;

/** "⌘K" on a Mac, "Ctrl K" elsewhere; the server can't tell, so it says Ctrl K until the browser does. */
function useShortcutLabel(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

/**
 * Jump to… (E27-6): the sidebar's search field, which opens a palette for
 * getting anywhere fast. ⌘K or Ctrl+K opens it from any page; the arrow
 * keys move, Enter opens, Esc closes and gives focus back.
 */
export function JumpTo() {
  const collapsed = useSidebarCollapsed();
  const shortcut = useShortcutLabel();
  const [open, setOpen] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!open) returnTo.current = document.activeElement as HTMLElement | null;
        setOpen((was) => !was);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openFrom = (element: HTMLElement) => {
    returnTo.current = element;
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => openFrom(event.currentTarget)}
        aria-label={collapsed ? "Jump to" : undefined}
        aria-keyshortcuts="Meta+K Control+K"
        title={collapsed ? `Jump to (${shortcut})` : undefined}
        className={cn(
          "flex h-[34px] items-center gap-2 rounded-control border border-line-card bg-surface text-control text-muted hover:bg-hover hover:text-ink motion-safe:transition-colors",
          collapsed ? "justify-center px-1.5" : "px-2.5",
        )}
      >
        <Search size={15} aria-hidden="true" className="shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Jump to…</span>
            <kbd className="rounded-[4px] border border-line-field px-[5px] py-px font-mono text-[11px] leading-none">{shortcut}</kbd>
          </>
        )}
      </button>
      {open && (
        <JumpDialog
          onClose={() => setOpen(false)}
          onClosed={() => {
            returnTo.current?.focus();
            returnTo.current = null;
          }}
        />
      )}
    </>
  );
}

function JumpDialog({ onClose, onClosed }: { onClose: () => void; onClosed: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<JumpGroup[] | null>(null);
  // The query the groups shown are for: while typing, it lags behind `query`.
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const latest = useRef(0);

  // Asks the server for each query after a short pause; only the latest answer counts.
  useEffect(() => {
    const asked = ++latest.current;
    const timer = setTimeout(
      async () => {
        const result = await jumpSearch({ q: query });
        if (asked !== latest.current) return;
        setGroups(result.ok ? result.data : []);
        setShownFor(query);
        setActive(0);
      },
      query ? SEARCH_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const results: JumpResult[] = groups?.flatMap((group) => group.results) ?? [];
  const optionId = (index: number) => `${listId}-${index}`;
  const go = (result: JumpResult | undefined) => {
    if (!result) return;
    onClose();
    router.push(result.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (active + step + results.length) % results.length;
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (shownFor === query) return go(results[active]);
      // Typed faster than the pause: Enter opens the first result for what's typed now, not the one shown.
      const typed = query;
      latest.current += 1;
      void jumpSearch({ q: typed }).then((result) => result.ok && go(result.data.flatMap((group) => group.results)[0]));
    }
  };

  // Each group's first option's place in `results`.
  const starts = (groups ?? []).map((_, at, all) => all.slice(0, at).reduce((sum, group) => sum + group.results.length, 0));
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed();
          }}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[min(560px,76vh)] w-[min(600px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-dialog border border-line-popover bg-card shadow-menu focus:outline-none"
        >
          <Dialog.Title className="sr-only">Jump to</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <input
              autoFocus
              role="combobox"
              aria-label="Jump to"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
              placeholder="Applications, positions, profiles, settings…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-12 flex-1 bg-transparent text-field placeholder:text-muted focus-visible:outline-none"
            />
          </div>
          <div id={listId} role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
            {groups !== null && results.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>}
            {groups?.map((group, at) => (
              <div key={group.label} role="group" aria-label={group.label} className="pb-1">
                <div aria-hidden="true" className="px-3 pt-2 pb-1 text-xs font-medium text-muted">
                  {group.label}
                </div>
                {group.results.map((result, offset) => {
                  const position = starts[at] + offset;
                  return (
                    <div
                      key={result.id}
                      id={optionId(position)}
                      role="option"
                      aria-selected={position === active}
                      onMouseMove={() => position !== active && setActive(position)}
                      onClick={() => go(result)}
                      className={cn("flex cursor-pointer items-baseline gap-3 rounded-control px-3 py-2 text-sm text-ink", position === active && "bg-selected")}
                    >
                      <span className="min-w-0 flex-1 truncate">{result.label}</span>
                      {/* Muted text is too faint on a selected row (globals.css): ink there. */}
                      {result.detail && <span className={cn("shrink-0 text-meta", position === active ? "text-ink" : "text-muted")}>{result.detail}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
