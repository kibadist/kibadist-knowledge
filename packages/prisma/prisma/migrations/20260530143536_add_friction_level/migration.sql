-- CreateEnum
CREATE TYPE "FrictionLevel" AS ENUM ('MINIMAL', 'LIGHT', 'DEEP', 'RIGOROUS');

-- AlterTable
ALTER TABLE "promotion_draft" ADD COLUMN     "frictionLevel" "FrictionLevel" NOT NULL DEFAULT 'DEEP';
