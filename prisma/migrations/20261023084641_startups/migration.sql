-- CreateEnum
CREATE TYPE "StartupStatus" AS ENUM ('NEW', 'SAVED', 'CONTACTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Startup" (
    "id" TEXT NOT NULL,
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
    "postedAt" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "scoredWith" TEXT NOT NULL DEFAULT '',
    "status" "StartupStatus" NOT NULL DEFAULT 'NEW',
    "noApplicationsFrom" TEXT NOT NULL DEFAULT '',
    "emailsCheckedAt" TIMESTAMP(3),
    "peopleCheckedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Startup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StartupBlock" (
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StartupBlock_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "Startup_applicationId_key" ON "Startup"("applicationId");

-- CreateIndex
CREATE INDEX "Startup_status_score_idx" ON "Startup"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Startup_source_externalId_key" ON "Startup"("source", "externalId");

-- AddForeignKey
ALTER TABLE "Startup" ADD CONSTRAINT "Startup_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
