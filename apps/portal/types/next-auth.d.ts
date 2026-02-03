import type { Role } from "@prisma/client";
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role?: Role;
      organizationId?: string;
    } & DefaultSession["user"];
  }
}
