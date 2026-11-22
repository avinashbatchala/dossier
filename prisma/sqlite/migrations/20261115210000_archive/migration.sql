-- The Archive (E22-7, #393): an untouched posting moves there some days after
-- a search last found it (archivedAt); the user can move it back (movedBackAt)
-- or remove it (removedAt).
-- AlterTable
ALTER TABLE "Posting" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Posting" ADD COLUMN "movedBackAt" DATETIME;
ALTER TABLE "Posting" ADD COLUMN "removedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Posting_archivedAt_idx" ON "Posting"("archivedAt");
