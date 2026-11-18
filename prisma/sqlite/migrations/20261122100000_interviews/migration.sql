-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "at" DATETIME,
    "minutes" INTEGER,
    "place" TEXT NOT NULL DEFAULT '',
    "people" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "prep" JSONB,
    "prepWrittenWith" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Interview_applicationId_round_key" ON "Interview"("applicationId", "round");

-- A next interview from before becomes round 1 (E30-6).
INSERT INTO "Interview" ("id", "applicationId", "round", "at", "updatedAt")
SELECT 'r1' || lower(hex(randomblob(12))), "id", 1, "nextInterviewAt", CURRENT_TIMESTAMP FROM "Application" WHERE "nextInterviewAt" IS NOT NULL;
