-- Scores per profile (E25-5, #412): a posting keeps a score for each profile
-- it was scored against. The scores so far were the first profile's: they
-- say so now. An agent search can score against every profile.

-- AlterTable
ALTER TABLE "AgentSearch" ADD COLUMN     "allProfiles" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: the column first, filled with the first profile, then the key.
ALTER TABLE "PostingScore" ADD COLUMN     "profileId" TEXT;
UPDATE "PostingScore" SET "profileId" = (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1);
DELETE FROM "PostingScore" WHERE "profileId" IS NULL;
ALTER TABLE "PostingScore" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "PostingScore" DROP CONSTRAINT "PostingScore_pkey",
ADD CONSTRAINT "PostingScore_pkey" PRIMARY KEY ("source", "externalId", "profileId");

-- CreateIndex
CREATE INDEX "PostingScore_profileId_score_idx" ON "PostingScore"("profileId", "score");

-- AddForeignKey
ALTER TABLE "PostingScore" ADD CONSTRAINT "PostingScore_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
