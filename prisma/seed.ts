// Seeds the database. Run on every start (see Dockerfile), and by hand with:
//
//   docker/bin/yarn prisma db seed                        built-in themes
//   docker/bin/yarn prisma db seed -- --demo              plus the prototype's sample data
//   docker/bin/yarn prisma db seed -- --demo --reset      replacing an existing profile and applications

import { createPrismaClient } from "@/lib/database";

import { seedBuiltIns } from "./seed/built-ins";
import { DemoRefused, seedDemo } from "./seed/demo";

const KNOWN_FLAGS = new Set(["--demo", "--reset"]);

async function main() {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) {
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Unknown option ${flag}. Use --demo, optionally with --reset.`);
  }
  if (flags.has("--reset") && !flags.has("--demo")) throw new Error("--reset only works together with --demo.");

  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  try {
    await seedBuiltIns(db);
    console.log("Seeded the built-in themes.");

    if (flags.has("--demo")) {
      const { applications } = await seedDemo(db, { reset: flags.has("--reset") });
      console.log(`Loaded the demo data: Jane Doe's profile and ${applications} applications.`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof DemoRefused ? error.message : error);
  process.exitCode = 1;
});
