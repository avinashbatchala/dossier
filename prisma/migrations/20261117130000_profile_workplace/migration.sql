-- Where each profile wants to work (E24-4, #405): it starts on-site and hybrid within 50 km of the
-- shared address's city, remote for employers in its country, not moving, until the user checks it.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "workplace" JSONB NOT NULL DEFAULT '{"modes":["ONSITE","HYBRID","REMOTE"],"radiusKm":50,"otherPlaces":[],"remoteOpenTo":"country","remoteCountries":[],"relocate":false,"relocatePlaces":[]}',
ADD COLUMN "workplaceSeenAt" TIMESTAMP(3);
