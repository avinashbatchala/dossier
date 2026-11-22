-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'signature',
    "data" BLOB NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "agentScore" INTEGER,
    "resumeFit" JSONB,
    "awaitingReview" BOOLEAN NOT NULL DEFAULT false,
    "signatureOnLetter" BOOLEAN NOT NULL DEFAULT false,
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
    "sentVia" TEXT,
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
    "messageDraft" JSONB,
    "contactedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Application" ("agentScore", "archivedAt", "awaitingReview", "boardSort", "company", "contactedAt", "createdAt", "deadline", "emailThreadId", "extracted", "extractedWith", "followThemeLayout", "frozen", "furthestStage", "id", "interviewCalendarId", "interviewEventId", "language", "location", "match", "matchedWith", "messageDraft", "mode", "nextInterviewAt", "origin", "postingText", "postingUrl", "profileId", "resumeFit", "role", "salary", "sections", "sentAt", "sentVia", "showPhoto", "status", "title", "tone", "updatedAt") SELECT "agentScore", "archivedAt", "awaitingReview", "boardSort", "company", "contactedAt", "createdAt", "deadline", "emailThreadId", "extracted", "extractedWith", "followThemeLayout", "frozen", "furthestStage", "id", "interviewCalendarId", "interviewEventId", "language", "location", "match", "matchedWith", "messageDraft", "mode", "nextInterviewAt", "origin", "postingText", "postingUrl", "profileId", "resumeFit", "role", "salary", "sections", "sentAt", "sentVia", "showPhoto", "status", "title", "tone", "updatedAt" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_status_idx" ON "Application"("status");
CREATE INDEX "Application_updatedAt_idx" ON "Application"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

