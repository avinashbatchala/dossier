"use client";

import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
 * On the resume, its switches follow (E30-9): the sidebar layout and the photo.
 */
export function ThemeMenu({
  themes,
  baseThemeId,
  current,
  onChange,
  options = [],
}: {
  themes: { id: string; name: string; builtIn: boolean }[];
  baseThemeId: string;
  current: { id: string; name: string };
  onChange: (themeId: string) => void;
  /** Switches under the themes, e.g. "Sidebar layout" and "Photo". */
  options?: { label: string; checked: boolean; onChange: (checked: boolean) => void }[];
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
        {options.length > 0 && <DropdownMenuSeparator />}
        {options.map((option) => (
          <DropdownMenuCheckboxItem key={option.label} checked={option.checked} onCheckedChange={option.onChange} onSelect={(event) => event.preventDefault()}>
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
