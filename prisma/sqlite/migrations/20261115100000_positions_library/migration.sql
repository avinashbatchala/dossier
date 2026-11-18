-- The positions library (E22-5, #391): every posting a search finds is kept
-- once, with when it was last found and when it was seen; PostingFind says
-- which search found it. The JSON of what each search found moves into the
-- library in code, once (movePastSearches); the column goes in a later release.
-- CreateTable
CREATE TABLE "PostingFind" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postingId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "foundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostingFind_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "Posting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostingFind_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "PostingSearch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Posting_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Posting" ("applicationId", "company", "complete", "createdAt", "description", "dismissedAt", "externalId", "id", "place", "postedAt", "remote", "salary", "savedAt", "source", "title", "updatedAt", "url", "via") SELECT "applicationId", "company", "complete", "createdAt", "description", "dismissedAt", "externalId", "id", "place", "postedAt", "remote", "salary", "savedAt", "source", "title", "updatedAt", "url", "via" FROM "Posting";
DROP TABLE "Posting";
ALTER TABLE "new_Posting" RENAME TO "Posting";
CREATE UNIQUE INDEX "Posting_applicationId_key" ON "Posting"("applicationId");
CREATE INDEX "Posting_savedAt_idx" ON "Posting"("savedAt");
CREATE INDEX "Posting_dismissedAt_idx" ON "Posting"("dismissedAt");
CREATE INDEX "Posting_lastFoundAt_idx" ON "Posting"("lastFoundAt");
CREATE UNIQUE INDEX "Posting_source_externalId_key" ON "Posting"("source", "externalId");
CREATE TABLE "new_PostingSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT,
    "query" JSONB NOT NULL,
    "postings" JSONB NOT NULL DEFAULT [],
    "portals" JSONB NOT NULL DEFAULT [],
    "found" INTEGER NOT NULL DEFAULT 0,
    "next" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PostingSearch" ("createdAt", "found", "id", "next", "postings", "query", "source", "updatedAt") SELECT "createdAt", "found", "id", "next", "postings", "query", "source", "updatedAt" FROM "PostingSearch";
DROP TABLE "PostingSearch";
ALTER TABLE "new_PostingSearch" RENAME TO "PostingSearch";
CREATE INDEX "PostingSearch_createdAt_idx" ON "PostingSearch"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PostingFind_searchId_idx" ON "PostingFind"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingFind_postingId_searchId_key" ON "PostingFind"("postingId", "searchId");


-- The postings kept so far (saved, dismissed, applied for) count as seen, and
-- as last found when they were kept.
UPDATE "Posting" SET "seenAt" = "updatedAt", "lastFoundAt" = "createdAt";
