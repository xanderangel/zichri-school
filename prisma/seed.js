// Creates the fixed initial administrator account described in the spec.
// Safe to run multiple times — it no-ops if the account already exists.
// Run with: npm run seed

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME || "Zichrisuperadmin100";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "123456789";

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`Bootstrap admin "${username}" already exists — skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: "ADMIN",
      accountStatus: "VERIFIED",
      // Forces the security-setup flow (two recovery emails + password
      // change) on first login, per spec.
      mustChangePassword: true,
      admin: { create: {} },
    },
  });

  await prisma.schoolSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "ACCOUNT_CREATED",
      targetType: "User",
      targetId: user.id,
      metadata: JSON.stringify({ note: "Bootstrap super-admin created by seed script" }),
    },
  });

  console.log(`Bootstrap admin "${username}" created.`);
  console.log(`Initial password is set — the admin MUST complete the forced security setup on first login.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
