-- CreateEnum
CREATE TYPE "ApplicationOrigin" AS ENUM ('MANUAL', 'AGENT');

-- CreateEnum
CREATE TYPE "AgentCandidateStatus" AS ENUM ('SCORED', 'DRAFTING', 'DRAFTED', 'APPROVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "agentScore" INTEGER,
ADD COLUMN     "awaitingReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origin" "ApplicationOrigin" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "AgentCandidate" (
    "id" TEXT NOT NULL,
    "source" "PostingSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "place" TEXT NOT NULL DEFAULT '',
    "remote" BOOLEAN,
    "salary" TEXT NOT NULL DEFAULT '',
    "postedAt" TIMESTAMP(3),
    "url" TEXT NOT NULL DEFAULT '',
    "via" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB,
    "redFlags" JSONB,
    "status" "AgentCandidateStatus" NOT NULL DEFAULT 'SCORED',
    "error" TEXT,
    "applicationId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCandidate_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "AgentCandidate" ADD CONSTRAINT "AgentCandidate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
