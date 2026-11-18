import type { ReactNode } from "react";

import { Breadcrumb, type Crumb } from "@/components/breadcrumb";
import { PageBar } from "@/components/page-header";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { flagInLine, type ApplicationFlag } from "@/lib/application-flag";
import { statusHref } from "@/lib/applications-list";
import { cn } from "@/lib/cn";
import { statusInfo } from "@/lib/status";

/**
 * The top of an application's page in one row (E30-2, design 3b): the
 * breadcrumb "Applications / Draft · apply by Thu 19 Nov" whose parts are
 * links (public issue 112), the title "Role at Company", the tabs, and the
 * status with the one thing to do next.
 */
export function ApplicationHeader({
  role,
  company,
  title,
  status,
  flag,
  tabs,
  actions,
  crumb,
  edit,
}: {
  role: string;
  company: string;
  /** The saved title, for an application without a role. */
  title: string;
  status: ApplicationStatus;
  /** What it needs next (E27-2), after the status. */
  flag: ApplicationFlag | null;
  /** The tab list. */
  tabs: ReactNode;
  actions: ReactNode;
  /** In place of the status's link, e.g. "New" before writing (E31-3). */
  crumb?: Crumb;
  /** After the title: ✎ to edit it (E31-3). */
  edit?: ReactNode;
}) {
  const what = role.trim() || title.trim() || "Untitled application";
  const at = company.trim() && company.trim() !== what ? company.trim() : "";
  return (
    <PageBar compact>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
        <Breadcrumb
          items={[
            { label: "Applications", href: "/applications" },
            {
              ...(crumb ?? { label: statusInfo(status).label, href: statusHref(status) }),
              extra: flag && (
                <>
                  {" · "}
                  <span className={cn(flag.soon && "text-warning")}>{flagInLine(flag.text)}</span>
                </>
              ),
            },
            // The page itself, which the heading below shows (#514).
            { label: at ? `${what} at ${at}` : what, hidden: true },
          ]}
        />
        <div className="flex min-w-0 items-center gap-2">
          <h1 title={at ? `${what} at ${at}` : what} className="truncate font-serif text-[26px] leading-[1.2] tracking-[-0.01em]">
            {what}
            {at && (
              <>
                {" "}
                <span className="text-muted">at</span> {at}
              </>
            )}
          </h1>
          {edit}
        </div>
      </div>
      {tabs}
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </PageBar>
  );
}
