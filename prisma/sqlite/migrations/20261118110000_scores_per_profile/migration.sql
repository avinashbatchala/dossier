-- Scores per profile (E25-5, #412): a posting keeps a score for each profile
-- it was scored against; the scores so far were the first profile's. An
-- agent search can score against every profile. Both tables are rebuilt;
-- neither has anything added by hand (COLLATE NOCASE and the trigger are on
-- Skill, Language and Theme).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT,
    "allProfiles" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentSearch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentSearch" ("createdAt", "enabled", "id", "name", "profileId", "query", "sort", "updatedAt") SELECT "createdAt", "enabled", "id", "name", "profileId", "query", "sort", "updatedAt" FROM "AgentSearch";
DROP TABLE "AgentSearch";
ALTER TABLE "new_AgentSearch" RENAME TO "AgentSearch";
CREATE INDEX "AgentSearch_sort_createdAt_idx" ON "AgentSearch"("sort", "createdAt");
CREATE TABLE "new_PostingScore" (
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "redFlags" JSONB NOT NULL,
    "scoredWith" TEXT NOT NULL,
    "breakdown" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("source", "externalId", "profileId"),
    CONSTRAINT "PostingScore_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Added by hand: the scores so far were the first profile's.
INSERT INTO "new_PostingScore" ("breakdown", "createdAt", "externalId", "reasons", "redFlags", "score", "scoredWith", "source", "updatedAt", "profileId") SELECT "breakdown", "createdAt", "externalId", "reasons", "redFlags", "score", "scoredWith", "source", "updatedAt", (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1) FROM "PostingScore" WHERE EXISTS (SELECT 1 FROM "Profile");
DROP TABLE "PostingScore";
ALTER TABLE "new_PostingScore" RENAME TO "PostingScore";
CREATE INDEX "PostingScore_profileId_score_idx" ON "PostingScore"("profileId", "score");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
