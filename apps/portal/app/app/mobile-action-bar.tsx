"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function withOrgQuery(path: string, orgId: string | null): string {
  if (!orgId) {
    return path;
  }
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}orgId=${encodeURIComponent(orgId)}`;
}

export default function MobileActionBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orgId = searchParams.get("orgId");

  function openQuickAdd() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("quickAdd", "1");
    if (orgId) {
      params.set("orgId", orgId);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const scheduleHref = withOrgQuery("/app/calendar?quickAction=schedule", orgId);
  const blockHref = withOrgQuery("/app/calendar?quickAction=block", orgId);

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
