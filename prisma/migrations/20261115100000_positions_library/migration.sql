-- The positions library (E22-5, #391): every posting a search finds is kept
-- once, with when it was last found and when it was seen; PostingFind says
-- which search found it. The JSON of what each search found moves into the
-- library in code, once (movePastSearches); the column goes in a later release.
-- AlterTable
ALTER TABLE "Posting" ADD COLUMN     "lastFoundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "seenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PostingSearch" ADD COLUMN     "portals" JSONB NOT NULL DEFAULT '[]',
ALTER COLUMN "source" DROP NOT NULL,
ALTER COLUMN "postings" SET DEFAULT '[]';

-- CreateTable
CREATE TABLE "PostingFind" (
    "id" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingFind_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingFind_searchId_idx" ON "PostingFind"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingFind_postingId_searchId_key" ON "PostingFind"("postingId", "searchId");

-- CreateIndex
CREATE INDEX "Posting_lastFoundAt_idx" ON "Posting"("lastFoundAt");

-- AddForeignKey
ALTER TABLE "PostingFind" ADD CONSTRAINT "PostingFind_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "Posting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingFind" ADD CONSTRAINT "PostingFind_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "PostingSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The postings kept so far (saved, dismissed, applied for) count as seen, and
-- as last found when they were kept.
UPDATE "Posting" SET "seenAt" = "updatedAt", "lastFoundAt" = "createdAt";
