-- Dossier 1.12.0 on SQLite: certifications, custom sections, which roles
-- are volunteering, what sent applications were sent with, the board's
-- order and AI usage. The 1.11.0 schema is the init migration, as the public
-- repository merged it. Experience is rebuilt for its new columns; it has
-- nothing added by hand (COLLATE NOCASE and the trigger are on Skill,
-- Language and Theme).

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "boardSort" INTEGER;
ALTER TABLE "Application" ADD COLUMN "frozen" JSONB;
ALTER TABLE "Application" ADD COLUMN "sections" JSONB;

-- AlterTable
ALTER TABLE "StatusEvent" ADD COLUMN "previousBoardSort" INTEGER;

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "issuer" TEXT NOT NULL DEFAULT '',
    "year" INTEGER,
    "month" INTEGER,
    "expiryYear" INTEGER,
    "expiryMonth" INTEGER,
    "credentialId" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "onResumes" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'ENTRIES',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "details" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "onResumes" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CustomSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Experience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "descriptor" TEXT NOT NULL DEFAULT '',
    "volunteering" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Experience" ("bullets", "company", "createdAt", "current", "descriptor", "endMonth", "endYear", "id", "location", "role", "sort", "startMonth", "startYear", "updatedAt") SELECT "bullets", "company", "createdAt", "current", "descriptor", "endMonth", "endYear", "id", "location", "role", "sort", "startMonth", "startYear", "updatedAt" FROM "Experience";
DROP TABLE "Experience";
ALTER TABLE "new_Experience" RENAME TO "Experience";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CustomItem_sectionId_idx" ON "CustomItem"("sectionId");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

