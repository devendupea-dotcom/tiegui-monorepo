"use client";

import { signOut } from "next-auth/react";

export default function LogoutButton() {
  return (
    <button
      type="button"
      className="btn secondary btn-logout"
      onClick={() => {
        void signOut({ callbackUrl: "/login" });
      }}
    >
      Log Out
    </button>
  );
}
