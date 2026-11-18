-- The same job on several portals (E22-6, #392): a posting can be merged into
-- another (mergedIntoId), and keeps its company normalised (matchCompany) to
-- find which to compare it with. Existing postings get it in code at start
-- (fillMatchKeys in src/lib/library.ts).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Posting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "place" TEXT NOT NULL DEFAULT '',
    "remote" BOOLEAN,
    "salary" TEXT NOT NULL DEFAULT '',
    "postedAt" DATETIME,
    "url" TEXT NOT NULL DEFAULT '',
    "via" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "savedAt" DATETIME,
    "dismissedAt" DATETIME,
    "applicationId" TEXT,
    "lastFoundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" DATETIME,
    "mergedIntoId" TEXT,
    "matchCompany" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Posting_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Posting_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Posting" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Posting" ("applicationId", "company", "complete", "createdAt", "description", "dismissedAt", "externalId", "id", "lastFoundAt", "place", "postedAt", "remote", "salary", "savedAt", "seenAt", "source", "title", "updatedAt", "url", "via") SELECT "applicationId", "company", "complete", "createdAt", "description", "dismissedAt", "externalId", "id", "lastFoundAt", "place", "postedAt", "remote", "salary", "savedAt", "seenAt", "source", "title", "updatedAt", "url", "via" FROM "Posting";
DROP TABLE "Posting";
ALTER TABLE "new_Posting" RENAME TO "Posting";
CREATE UNIQUE INDEX "Posting_applicationId_key" ON "Posting"("applicationId");
CREATE INDEX "Posting_savedAt_idx" ON "Posting"("savedAt");
CREATE INDEX "Posting_dismissedAt_idx" ON "Posting"("dismissedAt");
CREATE INDEX "Posting_lastFoundAt_idx" ON "Posting"("lastFoundAt");
CREATE INDEX "Posting_mergedIntoId_idx" ON "Posting"("mergedIntoId");
CREATE INDEX "Posting_matchCompany_idx" ON "Posting"("matchCompany");
CREATE UNIQUE INDEX "Posting_source_externalId_key" ON "Posting"("source", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

