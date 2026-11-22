-- Portals the user adds (E23-3, #399): a pinned copy of each config.
-- CreateTable
CREATE TABLE "InstalledPortal" (
    "id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "originUrl" TEXT,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstalledPortal_pkey" PRIMARY KEY ("id")
);
