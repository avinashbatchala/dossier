-- The portal catalog as last read from the backend (E23-2, #398).
-- CreateTable
CREATE TABLE "PortalCatalog" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "portals" JSONB NOT NULL DEFAULT '[]',
    "withdrawn" JSONB NOT NULL DEFAULT '[]',
    "commit" TEXT,
    "etag" TEXT,
    "readAt" TIMESTAMP(3),
    "nextReadAt" TIMESTAMP(3),

    CONSTRAINT "PortalCatalog_pkey" PRIMARY KEY ("id")
);
