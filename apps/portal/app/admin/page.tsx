import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  return (
    <main className="page">
      <section className="card">
        <h1>Admin</h1>
        <p className="muted">Signed in as {session?.user?.email}</p>
      </section>
    </main>
  );
}
