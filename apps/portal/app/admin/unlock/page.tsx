import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { normalizeEnvValue } from "@/lib/env";
import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import UnlockForm from "./unlock-form";

export const dynamic = "force-dynamic";

export default async function AdminUnlockPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login?next=/admin/unlock");

  const email = session.user.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (!user || user.role !== "INTERNAL") redirect("/dashboard");

  const vaultKey = normalizeEnvValue(process.env.ADMIN_VAULT_KEY);
  if (!vaultKey) {
    return (
      <main className="page">
        <section className="auth-card">
          <h1>Admin vault not configured</h1>
          <p className="muted">
            Set <code>ADMIN_VAULT_KEY</code> in your environment variables to enable admin access.
          </p>
        </section>
      </main>
    );
  }

  const vaultToken = cookies().get("tg_admin_vault")?.value;
  const decoded = await decode({ token: vaultToken, secret: vaultKey, salt: "admin-vault" });
  if (decoded?.sub === user.id && decoded.unlocked === true) {
    redirect("/admin");
  }

  return (
    <main className="page">
      <section className="auth-card">
        <h1>Unlock Admin</h1>
        <p className="muted">Enter the admin vault key to access admin tools.</p>
        <UnlockForm />
      </section>
    </main>
  );
}
