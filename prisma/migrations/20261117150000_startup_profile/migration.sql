-- The profile a startup fits best (E24-6, #407): Startups match against
-- every profile and keep the best one's score.

-- AlterTable
ALTER TABLE "Startup" ADD COLUMN     "profileId" TEXT;

-- AddForeignKey
ALTER TABLE "Startup" ADD CONSTRAINT "Startup_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Startups so far were scored against the first profile (E24-6).
UPDATE "Startup" SET "profileId" = (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1);
