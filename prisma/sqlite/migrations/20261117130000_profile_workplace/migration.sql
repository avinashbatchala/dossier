-- Where each profile wants to work (E24-4, #405): it starts on-site and hybrid within 50 km of the
-- shared address's city, remote for employers in its country, not moving, until the user checks it.
-- By hand: the JSON defaults quoted (Prisma writes them bare, which SQLite refuses).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "headline" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "levelFrom" TEXT,
    "levelTo" TEXT,
    "workplace" JSONB NOT NULL DEFAULT '{"modes":["ONSITE","HYBRID","REMOTE"],"radiusKm":50,"otherPlaces":[],"remoteOpenTo":"country","remoteCountries":[],"relocate":false,"relocatePlaces":[]}',
    "workplaceSeenAt" DATETIME,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Profile" ("createdAt", "headline", "id", "levelFrom", "levelTo", "name", "settings", "sort", "summary", "updatedAt") SELECT "createdAt", "headline", "id", "levelFrom", "levelTo", "name", "settings", "sort", "summary", "updatedAt" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

