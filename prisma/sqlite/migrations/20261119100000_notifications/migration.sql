-- Notifications (E26, #416–#418): the channels messages go to, with the
-- events each gets, and each message's delivery. The JSON default is
-- quoted by hand: Prisma's SQLite diff writes it bare.

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "secretEnc" TEXT,
    "events" JSONB NOT NULL DEFAULT '{}',
    "onlyNew" BOOLEAN NOT NULL DEFAULT true,
    "failuresInARow" INTEGER NOT NULL DEFAULT 0,
    "pausedAt" DATETIME,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationDelivery_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- CreateIndex
CREATE INDEX "NotificationChannel_sort_createdAt_idx" ON "NotificationChannel"("sort", "createdAt");
-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAt_idx" ON "NotificationDelivery"("status", "nextAt");
-- CreateIndex
CREATE INDEX "NotificationDelivery_createdAt_idx" ON "NotificationDelivery"("createdAt");
