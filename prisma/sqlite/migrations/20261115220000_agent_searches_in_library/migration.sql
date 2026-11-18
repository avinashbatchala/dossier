-- The job agent's finds in the library (E22-8, #394): each run of an agent
-- search is a PostingSearch, marked with the agent search it ran for.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PostingSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT,
    "query" JSONB NOT NULL,
    "postings" JSONB NOT NULL DEFAULT [],
    "portals" JSONB NOT NULL DEFAULT [],
    "found" INTEGER NOT NULL DEFAULT 0,
    "next" TEXT,
    "agentSearchId" TEXT,
    "agentSearchName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PostingSearch_agentSearchId_fkey" FOREIGN KEY ("agentSearchId") REFERENCES "AgentSearch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PostingSearch" ("createdAt", "found", "id", "next", "portals", "postings", "query", "source", "updatedAt") SELECT "createdAt", "found", "id", "next", "portals", "postings", "query", "source", "updatedAt" FROM "PostingSearch";
DROP TABLE "PostingSearch";
ALTER TABLE "new_PostingSearch" RENAME TO "PostingSearch";
CREATE INDEX "PostingSearch_createdAt_idx" ON "PostingSearch"("createdAt");
CREATE INDEX "PostingSearch_agentSearchId_idx" ON "PostingSearch"("agentSearchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

