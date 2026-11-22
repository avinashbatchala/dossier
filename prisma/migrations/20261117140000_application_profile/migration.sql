-- The profile an application was made from, and the one an agent search
-- scores and drafts with (E24-6, #407). What's there already was the first
-- profile's: it says so now. Deleting a profile leaves its applications
-- with none (they keep their own documents).

-- AlterTable
ALTER TABLE "AgentSearch" ADD COLUMN "profileId" TEXT;
ALTER TABLE "Application" ADD COLUMN "profileId" TEXT;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentSearch" ADD CONSTRAINT "AgentSearch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Added by hand: what's there was made from the first profile.
UPDATE "Application" SET "profileId" = (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1);
UPDATE "AgentSearch" SET "profileId" = (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1);
