import { PrismaClient } from "@prisma/client";
import { runSeed } from "./seed/index";

const prisma = new PrismaClient();

runSeed(prisma)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
