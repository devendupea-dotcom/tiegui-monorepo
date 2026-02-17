"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function withPortalQuery(path: string, orgId: string | null, mobileMode: boolean): string {
  if (!orgId && !mobileMode) {
    return path;
  }
  const target = new URL(path, "https://app.tieguisolutions.com");
  if (orgId) {
    target.searchParams.set("orgId", orgId);
  }
  if (mobileMode) {
    target.searchParams.set("mobile", "1");
  }
  const query = target.searchParams.toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
}

export default function MobileActionBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orgId = searchParams.get("orgId");
  const mobileMode = searchParams.get("mobile") === "1";

  function openQuickAdd() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("quickAdd", "1");
    if (orgId) {
      params.set("orgId", orgId);
    }
    if (mobileMode) {
      params.set("mobile", "1");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const scheduleHref = withPortalQuery("/app/calendar?quickAction=schedule", orgId, mobileMode);
  const blockHref = withPortalQuery("/app/calendar?quickAction=block", orgId, mobileMode);

  return (
    <nav className="mobile-action-bar" aria-label="Quick actions">
      <button type="button" className="mobile-action-btn primary" onClick={openQuickAdd}>
        +Lead
      </button>
      <Link className="mobile-action-btn" href={scheduleHref}>
        +Schedule
      </Link>
      <Link className="mobile-action-btn" href={blockHref}>
        +Block Time
      </Link>
    </nav>
  );
}
