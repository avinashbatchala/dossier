"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import { createContext, use } from "react";

import { cn } from "@/lib/cn";

/**
 * Tabs following the WAI-ARIA pattern: Tab moves into and out of the tab
 * list, the arrow keys move between tabs, and a tab's panel shows when it's
 * focused. Built on Radix Tabs; use `value`/`onValueChange` to control it.
 */
export const Tabs = TabsPrimitive.Root;

type TabsVariant = "underline" | "segmented" | "pills";

const VariantContext = createContext<TabsVariant>("underline");

export type TabsListProps = TabsPrimitive.TabsListProps & {
  /** `underline` for page tabs, `segmented` for tabs inside a panel, `pills` for tabs in a one-row header (E30-2). */
  variant?: TabsVariant;
};

export function TabsList({ variant = "underline", className, ...props }: TabsListProps) {
  return (
    <VariantContext value={variant}>
      <TabsPrimitive.List
        className={cn(
          "flex",
          variant === "underline"
            ? "flex-wrap gap-x-7 border-b border-line"
            : variant === "pills"
              ? "flex-wrap rounded-[9px] bg-track p-[3px]"
              : "rounded-[10px] bg-track p-[3px]",
          className,
        )}
        {...props}
      />
    </VariantContext>
  );
}

const triggerClassNames: Record<TabsVariant, string> = {
  underline:
    "-mb-px border-b-2 border-transparent pt-2.5 pb-[13px] text-sm text-muted hover:text-ink data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-ink",
  segmented:
    "flex-1 rounded-control p-2 text-control font-medium data-[state=active]:bg-card data-[state=active]:shadow-raised",
  pills:
    "flex items-center gap-1.5 rounded-[7px] px-[13px] py-1.5 text-[13.5px] text-document hover:text-ink data-[state=active]:bg-card data-[state=active]:font-medium data-[state=active]:text-ink data-[state=active]:shadow-raised",
};

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
  const variant = use(VariantContext);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        triggerClassNames[variant],
        "disabled:cursor-not-allowed disabled:text-faint",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps) {
  return <TabsPrimitive.Content className={cn("outline-offset-4", className)} {...props} />;
}
