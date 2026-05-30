-- CreateEnum
CREATE TYPE "Certainty" AS ENUM ('ASSERTED', 'TENTATIVE', 'UNCERTAIN');

-- AlterTable
ALTER TABLE "concept" ADD COLUMN     "certainty" "Certainty" NOT NULL DEFAULT 'ASSERTED';
