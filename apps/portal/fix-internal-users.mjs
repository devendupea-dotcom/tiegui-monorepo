import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const TEMP_PASSWORD = "TieGuiAdmin123!";
const TEMP_HASH = bcrypt.hashSync(TEMP_PASSWORD, 12);

async function main() {
  const deven = await prisma.user.update({
    where: { email: "deven@tiegui.com" },
    data: {
      email: "mrdupeallc@gmail.com",
      passwordHash: TEMP_HASH,
      mustChangePassword: true,
    },
    select: { email: true, role: true, orgId: true },
  });

  const marcus = await prisma.user.update({
    where: { email: "marcus@tiegui.com" },
    data: {
      email: "marcusunfiltered@gmail.com",
      passwordHash: TEMP_HASH,
      mustChangePassword: true,
    },
    select: { email: true, role: true, orgId: true },
  });

  console.table([deven, marcus]);
  console.log("Temp password (use once):", TEMP_PASSWORD);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
