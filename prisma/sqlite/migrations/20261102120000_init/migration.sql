-- The whole schema at Dossier 1.11.0. Skill and Language names compare
-- without case (COLLATE NOCASE, added by hand), as citext does in PostgreSQL.

-- CreateTable
CREATE TABLE "ProfileField" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL COLLATE NOCASE,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Language" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL COLLATE NOCASE,
    "level" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "descriptor" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "bullets" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExperienceSkill" (
    "experienceId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    PRIMARY KEY ("experienceId", "skillId"),
    CONSTRAINT "ExperienceSkill_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperienceSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "bullets" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProjectSkill" (
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "skillId"),
    CONSTRAINT "ProjectSkill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Education" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "degree" TEXT NOT NULL DEFAULT '',
    "school" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "citation" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "onResumes" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "relation" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Fact_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "headFont" TEXT NOT NULL,
    "bodyFont" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'SINGLE',
    "align" TEXT NOT NULL DEFAULT 'LEFT',
    "headingStyle" TEXT NOT NULL DEFAULT 'PLAIN',
    "density" TEXT NOT NULL DEFAULT 'REGULAR',
    "headerStyle" TEXT NOT NULL DEFAULT 'PLAIN',
    "sidebarStyle" TEXT NOT NULL DEFAULT 'PLAIN',
    "dateStyle" TEXT NOT NULL DEFAULT 'INLINE',
    "photoShape" TEXT NOT NULL DEFAULT 'CIRCLE',
    "photoPosition" TEXT NOT NULL DEFAULT 'HEADER_END',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "agentScore" INTEGER,
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
    "furthestStage" TEXT,
    "sentAt" DATETIME,
    "nextInterviewAt" DATETIME,
    "tone" TEXT NOT NULL DEFAULT 'WARM',
    "language" TEXT NOT NULL DEFAULT '',
    "followThemeLayout" BOOLEAN NOT NULL DEFAULT false,
    "showPhoto" BOOLEAN,
    "archivedAt" DATETIME,
    "emailThreadId" TEXT,
    "interviewEventId" TEXT,
    "interviewCalendarId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousFurthestStage" TEXT,
    "previousSentAt" DATETIME,
    CONSTRAINT "StatusEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "units" JSONB NOT NULL,
    "themeId" TEXT,
    "writtenWith" TEXT,
    "trimmed" JSONB,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "units" JSONB NOT NULL,
    "cause" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "targetUnit" TEXT,
    "edits" JSONB,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "previousTone" TEXT,
    "writtenWith" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Note_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Posting" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Posting_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaudePaste" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentCandidate" (
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
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB,
    "redFlags" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SCORED',
    "error" TEXT,
    "applicationId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentCandidate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostingScore" (
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "redFlags" JSONB NOT NULL,
    "scoredWith" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("source", "externalId")
);

-- CreateTable
CREATE TABLE "PostingSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "postings" JSONB NOT NULL,
    "found" INTEGER NOT NULL DEFAULT 0,
    "next" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Startup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "remote" BOOLEAN,
    "stage" TEXT NOT NULL DEFAULT '',
    "roles" JSONB NOT NULL,
    "emails" JSONB NOT NULL,
    "links" JSONB NOT NULL,
    "postedAt" DATETIME,
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "scoredWith" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "noApplicationsFrom" TEXT NOT NULL DEFAULT '',
    "emailsCheckedAt" DATETIME,
    "peopleCheckedAt" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    "seenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Startup_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StartupBlock" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'google',
    "email" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "historyId" TEXT,
    "lastSyncAt" DATETIME,
    "syncProblem" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "applicationId" TEXT,
    "direction" TEXT NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT '',
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "toAddress" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "messageId" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME NOT NULL,
    "kind" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "questions" JSONB,
    "suggestedStatus" TEXT,
    "confirmedAt" DATETIME,
    "classifiedWith" TEXT,
    "replyDraft" TEXT NOT NULL DEFAULT '',
    "replyGaps" JSONB,
    "draftedWith" TEXT,
    "handledAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" DATETIME NOT NULL,
    "blockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "key" TEXT,
    "applicationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "step" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Language_name_key" ON "Language"("name");

-- CreateIndex
CREATE INDEX "ExperienceSkill_skillId_idx" ON "ExperienceSkill"("skillId");

-- CreateIndex
CREATE INDEX "ProjectSkill_skillId_idx" ON "ProjectSkill"("skillId");

-- CreateIndex
CREATE INDEX "Fact_applicationId_sort_idx" ON "Fact"("applicationId", "sort");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_updatedAt_idx" ON "Application"("updatedAt");

-- CreateIndex
CREATE INDEX "StatusEvent_applicationId_at_idx" ON "StatusEvent"("applicationId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Document_applicationId_kind_key" ON "Document"("applicationId", "kind");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_createdAt_idx" ON "DocumentVersion"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_applicationId_createdAt_idx" ON "ChatMessage"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "Note_applicationId_createdAt_idx" ON "Note"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Posting_applicationId_key" ON "Posting"("applicationId");

-- CreateIndex
CREATE INDEX "Posting_savedAt_idx" ON "Posting"("savedAt");

-- CreateIndex
CREATE INDEX "Posting_dismissedAt_idx" ON "Posting"("dismissedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Posting_source_externalId_key" ON "Posting"("source", "externalId");

-- CreateIndex
CREATE INDEX "ClaudePaste_expiresAt_idx" ON "ClaudePaste"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCandidate_applicationId_key" ON "AgentCandidate"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCandidate_dedupeKey_key" ON "AgentCandidate"("dedupeKey");

-- CreateIndex
CREATE INDEX "AgentCandidate_status_score_idx" ON "AgentCandidate"("status", "score");

-- CreateIndex
CREATE INDEX "AgentCandidate_createdAt_idx" ON "AgentCandidate"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCandidate_source_externalId_key" ON "AgentCandidate"("source", "externalId");

-- CreateIndex
CREATE INDEX "PostingSearch_createdAt_idx" ON "PostingSearch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Startup_applicationId_key" ON "Startup"("applicationId");

-- CreateIndex
CREATE INDEX "Startup_status_score_idx" ON "Startup"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Startup_source_externalId_key" ON "Startup"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_gmailId_key" ON "EmailMessage"("gmailId");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_idx" ON "EmailMessage"("threadId");

-- CreateIndex
CREATE INDEX "EmailMessage_applicationId_sentAt_idx" ON "EmailMessage"("applicationId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_sentAt_idx" ON "EmailMessage"("sentAt");

-- CreateIndex
CREATE INDEX "LoginThrottle_updatedAt_idx" ON "LoginThrottle"("updatedAt");

-- CreateIndex
CREATE INDEX "Job_key_createdAt_idx" ON "Job"("key", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_applicationId_idx" ON "Job"("applicationId");

-- Built-in themes can't be deleted, as in PostgreSQL (added by hand: Prisma
-- doesn't manage triggers). Tests empty the table by clearing builtIn first.
CREATE TRIGGER "Theme_prevent_builtin_delete"
BEFORE DELETE ON "Theme"
WHEN OLD."builtIn"
BEGIN
  SELECT RAISE(ABORT, 'A built-in theme can''t be deleted.');
END;
