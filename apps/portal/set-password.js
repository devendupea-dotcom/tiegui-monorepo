const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

(async () => {
  const hash = await bcrypt.hash('testing123', 10);

  await prisma.user.update({
    where: { email: 'tieguisolutions@gmail.com' },
    data: {
      passwordHash: hash,
      mustChangePassword: false,
    },
  });

  console.log('Password set to testing123');
  await prisma.$disconnect();
})();
