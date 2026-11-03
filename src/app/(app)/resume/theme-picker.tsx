"use client";

import { useRef, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { resolveTheme, THEME_FONTS, type ThemeData } from "@/lib/themes";

type ThemePickerProps = {
  themes: ThemeData[];
  activeId: string;
  /** Set in the thumbnails' heading font. */
  userName: string;
  onSelect: (id: string) => void;
  onCustomize: () => void;
  /** What can be done with the theme in use (E5-7). */
  actions?: {
    duplicate: () => void;
    exportFile: () => void;
    remove: () => void;
    importFile: (file: File) => void;
  };
};

/**
 * What screen readers hear after a theme's visible name: "Classic theme, in
 * use". The buttons are named by their text rather than an aria-label, which
 * would have to repeat everything they show, the sketch's name included
 * (WCAG 2.5.3).
 */
function NameSuffix({ active }: { active: boolean }) {
  return (
    <>
      {" "}
      <span className="sr-only">{`theme${active ? ", in use" : ""}`}</span>
    </>
  );
}

/** The Themes tab: built-in thumbnails, your own themes, and a way to make one (RES-2, RES-4). */
export function ThemePicker({ themes, activeId, userName, onSelect, onCustomize, actions }: ThemePickerProps) {
  const builtIn = themes.filter((theme) => theme.builtIn);
  const custom = themes.filter((theme) => !theme.builtIn);
  const active = themes.find((theme) => theme.id === activeId);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3.5">
      <h2 className="text-label text-muted">Built-in</h2>
      <div className="grid grid-cols-2 gap-3.5">
        {builtIn.map((theme) => (
          <ThemeThumbnail
            key={theme.id}
            theme={theme}
            active={theme.id === activeId}
            userName={userName}
            onSelect={() => onSelect(theme.id)}
          />
        ))}
      </div>

      <h2 className="mt-2.5 text-label text-muted">Your themes</h2>
      {custom.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {custom.map((theme) => {
            const active = theme.id === activeId;
            return (
              <button
                key={theme.id}
                type="button"
                data-in-use={active || undefined}
                onClick={() => onSelect(theme.id)}
                className={cn(
                  "flex items-center gap-3 rounded-[10px] border bg-card px-3.5 py-3 text-left",
                  active ? "border-primary" : "border-line-card hover:border-line-strong",
                )}
              >
                <span aria-hidden className="size-3.5 flex-none rounded-full" style={{ background: theme.accent }} />
                <span className="flex-1 truncate text-sm" style={{ fontFamily: THEME_FONTS[theme.headFont].family }}>
                  {theme.name}
                  <NameSuffix active={active} />
                </span>
                {active && (
                  <span aria-hidden className="text-xs text-muted">
                    In use
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={onCustomize}
        className="flex flex-col gap-[3px] rounded-[10px] border border-dashed border-line-strong p-3.5 text-left text-control hover:border-line-strong"
      >
        <span className="font-medium">+ Make your own theme</span>
        <span className="text-meta text-muted">Start from the current one and change fonts, color and layout.</span>
      </button>

      {actions && active && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-meta text-muted">
            In use: <span className="text-ink">{active.name}</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Button variant="text" size="sm" aria-label={`Duplicate ${active.name}`} onClick={actions.duplicate}>
              Duplicate
            </Button>
            <Button variant="text" size="sm" aria-label={`Export ${active.name}`} onClick={actions.exportFile}>
              Export
            </Button>
            {!active.builtIn && (
              <Button variant="danger-text" size="sm" aria-label={`Delete ${active.name}…`} onClick={actions.remove}>
                Delete…
              </Button>
            )}
          </div>
          <Button variant="text" size="sm" className="self-start" onClick={() => fileInput.current?.click()}>
            Import a theme…
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) actions.importFile(file);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A 150px sketch of a theme: your name in its heading font, under an accent
 * rule or on a banner, and the outline of its layout, with the sidebar on
 * its side (tinted or not), titles beside their sections, or a timeline.
 */
function ThemeThumbnail({
  theme,
  active,
  userName,
  onSelect,
}: {
  theme: ThemeData;
  active: boolean;
  userName: string;
  onSelect: () => void;
}) {
  const { split, sidebarEnd, tintedSidebar, sideHeadings, centered, banner, onAccent, timeline } = resolveTheme(theme);
  const accent = { background: theme.accent };
  const name = (
    <span
      className={cn("truncate text-[11px] font-medium", centered && "text-center")}
      style={{ fontFamily: THEME_FONTS[theme.headFont].family, ...(banner && { color: onAccent }) }}
    >
      {userName}
    </span>
  );
  const sidebar = split && (
    <span
      className={cn("flex flex-col gap-1", tintedSidebar && "-my-1 rounded-[2px] px-1 py-1")}
      style={tintedSidebar ? { background: `color-mix(in srgb, ${theme.accent} 10%, #fff)` } : undefined}
    >
      <Bar className="w-[70%]" style={accent} />
      <Bar />
      <Bar />
      <Bar className="w-[60%]" />
    </span>
  );
  const sketch = { accent, sideHeadings, timeline };
  return (
    <button
      type="button"
      data-in-use={active || undefined}
      onClick={onSelect}
      className="group flex flex-col gap-2 text-left"
    >
      <span
        aria-hidden
        className={cn(
          // A sketch of a white page, in the documents' own ink, so it stays light in the dark scheme too.
          "flex h-[150px] w-full flex-col gap-2 overflow-hidden rounded-control bg-white px-3 py-3.5 text-[#1d1c1a]",
          active ? "ring-2 ring-primary" : "ring-1 ring-line-popover group-hover:ring-line-strong",
        )}
      >
        {banner ? (
          <span className="-mx-1 flex flex-col rounded-[3px] px-2 py-1.5" style={accent}>
            {name}
          </span>
        ) : (
          <>
            {name}
            <span className="h-px opacity-60" style={accent} />
          </>
        )}
        <span
          className={cn(
            "grid flex-1 gap-[7px]",
            !split ? "grid-cols-1" : sidebarEnd ? "grid-cols-[1fr_30%]" : "grid-cols-[30%_1fr]",
          )}
        >
          {!sidebarEnd && sidebar}
          <span className="flex flex-col gap-[5px]">
            <SketchSection {...sketch} title="w-[40%]" lines={["w-full", "w-full", "w-[80%]"]} />
            <SketchSection {...sketch} title="w-[35%]" lines={["w-full", "w-[70%]"]} />
          </span>
          {sidebarEnd && sidebar}
        </span>
      </span>
      <span className="flex items-baseline justify-between text-control">
        <span className={active ? "font-semibold" : undefined}>
          {theme.name}
          <NameSuffix active={active} />
        </span>
        {active && (
          <span aria-hidden className="text-xs text-muted">
            In use
          </span>
        )}
      </span>
    </button>
  );
}

/** A section in a thumbnail: its title in the accent and a few lines, with the title beside them or a date before each. */
function SketchSection({
  title,
  lines,
  accent,
  sideHeadings,
  timeline,
}: {
  title: string;
  lines: string[];
  accent: CSSProperties;
  sideHeadings: boolean;
  timeline: boolean;
}) {
  const body = lines.map((width, index) =>
    timeline ? (
      <span key={index} className={cn("flex gap-1", width)}>
        <Bar className="w-[22%] flex-none opacity-70" />
        <Bar className="flex-1" />
      </span>
    ) : (
      <Bar key={index} className={width} />
    ),
  );
  return sideHeadings ? (
    <span className="grid grid-cols-[24%_1fr] gap-x-1.5">
      <Bar className="w-full" style={accent} />
      <span className="flex flex-col gap-1">{body}</span>
    </span>
  ) : (
    <span className="flex flex-col gap-1">
      <Bar className={title} style={accent} />
      {body}
    </span>
  );
}

function Bar({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cn("block h-[3px] bg-[#e2dfd8]", className)} style={style} />;
}
