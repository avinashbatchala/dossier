-- CreateTable
CREATE TABLE "ClaudePaste" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaudePaste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaudePaste_expiresAt_idx" ON "ClaudePaste"("expiresAt");
