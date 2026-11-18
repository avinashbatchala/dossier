-- The profile an application was made from, and the one an agent search
-- scores and drafts with (E24-6, #407). What's there already was the first
-- profile's: it says so now. Deleting a profile leaves its applications
-- with none (they keep their own documents). Both tables are rebuilt for
-- the column; neither has anything added by hand (COLLATE NOCASE and the
-- trigger are on Skill, Language and Theme).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentSearch_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentSearch" ("createdAt", "enabled", "id", "name", "query", "sort", "updatedAt") SELECT "createdAt", "enabled", "id", "name", "query", "sort", "updatedAt" FROM "AgentSearch";
DROP TABLE "AgentSearch";
ALTER TABLE "new_AgentSearch" RENAME TO "AgentSearch";
CREATE INDEX "AgentSearch_sort_createdAt_idx" ON "AgentSearch"("sort", "createdAt");
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "agentScore" INTEGER,
    "resumeFit" JSONB,
    "awaitingReview" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT '',
    "salary" TEXT NOT NULL DEFAULT '',
    "deadline" DATETIME,
    "postingUrl" TEXT NOT NULL DEFAULT '',
    "postingText" TEXT NOT NULL DEFAULT '',
    "extracted" JSONB,
    "extractedWith" TEXT,
    "match" JSONB,
    "matchedWith" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "boardSort" INTEGER,
    "furthestStage" TEXT,
    "sentAt" DATETIME,
    "nextInterviewAt" DATETIME,
    "tone" TEXT NOT NULL DEFAULT 'WARM',
    "language" TEXT NOT NULL DEFAULT '',
    "followThemeLayout" BOOLEAN NOT NULL DEFAULT false,
    "showPhoto" BOOLEAN,
    "sections" JSONB,
    "frozen" JSONB,
    "archivedAt" DATETIME,
    "emailThreadId" TEXT,
    "interviewEventId" TEXT,
    "interviewCalendarId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Application" ("agentScore", "archivedAt", "awaitingReview", "boardSort", "company", "createdAt", "deadline", "emailThreadId", "extracted", "extractedWith", "followThemeLayout", "frozen", "furthestStage", "id", "interviewCalendarId", "interviewEventId", "language", "location", "match", "matchedWith", "mode", "nextInterviewAt", "origin", "postingText", "postingUrl", "resumeFit", "role", "salary", "sections", "sentAt", "showPhoto", "status", "title", "tone", "updatedAt") SELECT "agentScore", "archivedAt", "awaitingReview", "boardSort", "company", "createdAt", "deadline", "emailThreadId", "extracted", "extractedWith", "followThemeLayout", "frozen", "furthestStage", "id", "interviewCalendarId", "interviewEventId", "language", "location", "match", "matchedWith", "mode", "nextInterviewAt", "origin", "postingText", "postingUrl", "resumeFit", "role", "salary", "sections", "sentAt", "showPhoto", "status", "title", "tone", "updatedAt" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_status_idx" ON "Application"("status");
CREATE INDEX "Application_updatedAt_idx" ON "Application"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Added by hand: what's there was made from the first profile.
UPDATE "Application" SET "profileId" = (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1);
UPDATE "AgentSearch" SET "profileId" = (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1);
