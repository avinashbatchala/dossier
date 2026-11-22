-- The levels each profile is for (E24-3, #404); empty until the user chooses them.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "levelFrom" TEXT;
ALTER TABLE "Profile" ADD COLUMN "levelTo" TEXT;
