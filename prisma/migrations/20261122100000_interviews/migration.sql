-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "at" TIMESTAMP(3),
    "minutes" INTEGER,
    "place" TEXT NOT NULL DEFAULT '',
    "people" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "prep" JSONB,
    "prepWrittenWith" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Interview_applicationId_round_key" ON "Interview"("applicationId", "round");

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A next interview from before becomes round 1 (E30-6).
INSERT INTO "Interview" ("id", "applicationId", "round", "at", "updatedAt")
SELECT 'r1' || md5("id"), "id", 1, "nextInterviewAt", CURRENT_TIMESTAMP FROM "Application" WHERE "nextInterviewAt" IS NOT NULL;
