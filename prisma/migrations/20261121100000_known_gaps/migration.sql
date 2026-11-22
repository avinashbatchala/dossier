-- CreateTable
CREATE TABLE "KnownGap" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnownGap_applicationId_requirement_key" ON "KnownGap"("applicationId", "requirement");

-- AddForeignKey
ALTER TABLE "KnownGap" ADD CONSTRAINT "KnownGap_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

