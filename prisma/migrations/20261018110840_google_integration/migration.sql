-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- CreateEnum
CREATE TYPE "ReplyKind" AS ENUM ('REJECTION', 'INTERVIEW', 'QUESTION', 'OFFER', 'ACKNOWLEDGEMENT', 'OTHER');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "emailThreadId" TEXT;

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL DEFAULT 'google',
    "email" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "historyId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "syncProblem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "applicationId" TEXT,
    "direction" "EmailDirection" NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT '',
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "toAddress" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "messageId" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "kind" "ReplyKind",
    "summary" TEXT NOT NULL DEFAULT '',
    "questions" JSONB,
    "suggestedStatus" "ApplicationStatus",
    "confirmedAt" TIMESTAMP(3),
    "classifiedWith" TEXT,
    "replyDraft" TEXT NOT NULL DEFAULT '',
    "replyGaps" JSONB,
    "draftedWith" TEXT,
    "handledAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_gmailId_key" ON "EmailMessage"("gmailId");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_idx" ON "EmailMessage"("threadId");

-- CreateIndex
CREATE INDEX "EmailMessage_applicationId_sentAt_idx" ON "EmailMessage"("applicationId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_sentAt_idx" ON "EmailMessage"("sentAt");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
