import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

type AppSession = Session & {
  user?:
    | (Session["user"] & {
        role?: string;
      })
    | null;
};

export default async function HomePage() {
  const session = (await getServerSession(authOptions)) as AppSession | null;

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role === "INTERNAL") {
    redirect("/hq");
  }

  redirect("/dashboard");
}
