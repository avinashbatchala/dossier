"use client";

import { DropdownMenu as MenuPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

/**
 * A menu that opens from a trigger button, built on Radix DropdownMenu: it
 * moves focus into the menu, supports the arrow keys and typeahead, closes on
 * Escape or an outside click, and returns focus to the trigger. It isn't
 * modal: a modal menu hides the rest of the page from screen readers with
 * aria-hidden while its links stay focusable (E11-3).
 *
 *     <DropdownMenu>
 *       <DropdownMenuTrigger asChild><Button>Status</Button></DropdownMenuTrigger>
 *       <DropdownMenuContent>
 *         <DropdownMenuItem onSelect={…}>…</DropdownMenuItem>
 *       </DropdownMenuContent>
 *     </DropdownMenu>
 */
export function DropdownMenu({ modal = false, ...props }: MenuPrimitive.DropdownMenuProps) {
  return <MenuPrimitive.Root modal={modal} {...props} />;
}
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: MenuPrimitive.DropdownMenuContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-30 flex min-w-[230px] flex-col rounded-card border border-line-popover bg-card p-1.5 shadow-menu",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuLabel({ className, ...props }: MenuPrimitive.DropdownMenuLabelProps) {
  return (
    <MenuPrimitive.Label
      className={cn("px-2.5 pt-2 pb-1.5 text-xs text-muted", className)}
      {...props}
    />
  );
}

// Pointer hover only tints the item; keyboard focus also gets the global
// focus ring, drawn inside the item so the menu's padding doesn't clip it.
const itemClassName =
  "flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-sm text-ink select-none focus:outline-none focus-visible:outline-solid focus-visible:-outline-offset-2 data-disabled:cursor-not-allowed data-disabled:text-faint data-highlighted:bg-hover";

export function DropdownMenuItem({ className, ...props }: MenuPrimitive.DropdownMenuItemProps) {
  return <MenuPrimitive.Item className={cn(itemClassName, className)} {...props} />;
}

/** One choice in a `DropdownMenuRadioGroup`; the chosen one is ticked. */
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.DropdownMenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(itemClassName, "data-[state=checked]:bg-selected", className)}
      {...props}
    >
      <span className="flex flex-1 items-center gap-2.5">{children}</span>
      <MenuPrimitive.ItemIndicator className="text-xs" aria-hidden="true">
        ✓
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

/** An on/off choice in a menu, e.g. "Photo"; ticked when on. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: MenuPrimitive.DropdownMenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(itemClassName, className)} {...props}>
      <span className="flex flex-1 items-center gap-2.5">{children}</span>
      <MenuPrimitive.ItemIndicator className="text-xs" aria-hidden="true">
        ✓
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.DropdownMenuSeparatorProps) {
  return <MenuPrimitive.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}
