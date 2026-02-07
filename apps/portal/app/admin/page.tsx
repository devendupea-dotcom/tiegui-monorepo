import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import CreateUserForm from "./create-user-form";
import LockButton from "./lock-button";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (!session?.user?.email || role !== "INTERNAL") {
    redirect("/login?next=/admin");
  }

  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        orgId: true,
        mustChangePassword: true,
        org: { select: { name: true } },
      },
      orderBy: { email: "asc" },
    }),
    prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <main className="page">
      <section className="card">
        <h1>Admin</h1>
        <p className="muted">Signed in as {session.user.email}</p>
        <div style={{ marginTop: 12 }}>
          <LockButton />
        </div>
      </section>

      <section className="card">
        <h2>Create user</h2>
        <p className="muted">
          Creates a user and sends them a link to set their password (same flow as “Forgot
          password”).
        </p>
        <CreateUserForm organizations={organizations} />
      </section>

      <section className="card">
        <h2>Users</h2>
        {users.length === 0 ? (
          <p className="muted">No users found.</p>
        ) : (
          <ul className="list">
            {users.map((user) => (
              <li key={user.id}>
                <strong>{user.name || user.email}</strong>
                <span className="muted">
                  {user.role}
                  {user.org ? ` • ${user.org.name}` : ""}
                  {user.mustChangePassword ? " • must change password" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
