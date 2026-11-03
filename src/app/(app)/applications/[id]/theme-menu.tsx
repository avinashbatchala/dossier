"use client";

import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * "Editorial theme ▾" above the Resume and Cover letter tabs' preview (#226,
 * public issue 10): every theme, built-ins first, with the base theme marked.
 * Picking one gives the application's resume and cover letter that theme.
 */
export function ThemeMenu({
  themes,
  baseThemeId,
  current,
  onChange,
}: {
  themes: { id: string; name: string; builtIn: boolean }[];
  baseThemeId: string;
  current: { id: string; name: string };
  onChange: (themeId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="text" size="sm" className="data-[state=open]:text-ink">
          {current.name} theme
          <span aria-hidden="true" className="text-[10px]">
            ▼
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
        <DropdownMenuLabel>Theme for this resume and cover letter</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.id} onValueChange={(id) => id !== current.id && onChange(id)}>
          {themes.map((theme, index) => (
            <Fragment key={theme.id}>
              {/* Your own themes come after the built-ins, as on the Base resume screen. */}
              {index > 0 && !theme.builtIn && themes[index - 1].builtIn && <DropdownMenuSeparator />}
              <DropdownMenuRadioItem value={theme.id}>
                {theme.name}
                {/* The space only keeps the item's name readable: "Modern base theme". */}
                {theme.id === baseThemeId && <> <span className="text-meta text-muted">base theme</span></>}
              </DropdownMenuRadioItem>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
