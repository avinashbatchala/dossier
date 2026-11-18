import { PortalRegistry } from "@/components/portal-registry";
import { verifySession } from "@/lib/auth/session";
import { portalInfo } from "@/lib/job-search/sources";
import { loadInstalledPortals } from "@/lib/portals/installed";

/** The setup guide's shell (E21): the guide alone, without the sidebar, so nothing else asks for attention. */
export default async function SetupLayout({ children }: LayoutProps<"/">) {
  await verifySession();
  const installed = await loadInstalledPortals();
  return (
    <div className="min-h-screen bg-surface">
      <PortalRegistry portals={installed.map((portal) => portalInfo(portal.config))}>{children}</PortalRegistry>
    </div>
  );
}
