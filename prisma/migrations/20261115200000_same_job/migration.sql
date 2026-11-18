-- The same job on several portals (E22-6, #392): a posting can be merged into
-- another (mergedIntoId), and keeps its company normalised (matchCompany) to
-- find which to compare it with. Existing postings get it in code at start
-- (fillMatchKeys in src/lib/library.ts).
-- AlterTable
ALTER TABLE "Posting" ADD COLUMN     "matchCompany" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mergedIntoId" TEXT;

-- CreateIndex
CREATE INDEX "Posting_mergedIntoId_idx" ON "Posting"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Posting_matchCompany_idx" ON "Posting"("matchCompany");

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Posting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

