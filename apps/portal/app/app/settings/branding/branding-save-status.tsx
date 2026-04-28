"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type BrandingSaveStatusProps = {
  errorMessage?: string | null;
  saved: boolean;
  successMessage: string;
};

export default function BrandingSaveStatus({
  errorMessage,
  saved,
  successMessage,
}: BrandingSaveStatusProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [notice, setNotice] = useState<string | null>(saved ? successMessage : null);

  useEffect(() => {
    if (!saved) {
      return;
    }

    setNotice(successMessage);

    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("saved")) {
      return;
    }

    params.delete("saved");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, saved, searchParams, successMessage]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (notice) {
    return <p className="form-status">{notice}</p>;
  }

  if (errorMessage) {
    return <p className="form-status">{errorMessage}</p>;
  }

  return null;
}
