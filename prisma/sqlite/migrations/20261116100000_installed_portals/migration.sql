-- Portals the user adds (E23-3, #399): a pinned copy of each config.
-- CreateTable
CREATE TABLE "InstalledPortal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "config" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "originUrl" TEXT,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
