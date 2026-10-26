-- CreateEnum
CREATE TYPE "PhotoShape" AS ENUM ('CIRCLE', 'ROUNDED', 'SQUARE', 'PORTRAIT');

-- CreateEnum
CREATE TYPE "PhotoPosition" AS ENUM ('HEADER_END', 'HEADER_START', 'ABOVE_NAME', 'SIDEBAR');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "showPhoto" BOOLEAN;

-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "photoPosition" "PhotoPosition" NOT NULL DEFAULT 'HEADER_END',
ADD COLUMN     "photoShape" "PhotoShape" NOT NULL DEFAULT 'CIRCLE';
