-- Source block role classifier (DET-346). A richer, learning-oriented role
-- taxonomy layered alongside the existing noise classification, with importance,
-- recommended placement, a reason, and a confidence. Persisted on each block so
-- downstream segmentation/generation can keep the substance and move/discard the
-- filler/navigation/reference clutter, and fidelity review can audit the moves.

-- CreateEnum
CREATE TYPE "SourceBlockRole" AS ENUM (
  'CORE_CLAIM',
  'DEFINITION',
  'EXAMPLE',
  'ANALOGY',
  'CAVEAT',
  'TRANSITION',
  'INSTRUCTOR_ASIDE',
  'FILLER',
  'NAVIGATION',
  'REFERENCE',
  'BIBLIOGRAPHY',
  'EXTERNAL_LINK',
  'CAPTION',
  'TABLE',
  'UNKNOWN'
);

-- CreateEnum
CREATE TYPE "SourceBlockImportance" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SourceBlockPlacement" AS ENUM ('MAIN_BODY', 'CALLOUT', 'SOURCE_NOTES', 'DISCARD');

-- AlterTable
ALTER TABLE "transformer_source_blocks" ADD COLUMN "role" "SourceBlockRole";
ALTER TABLE "transformer_source_blocks" ADD COLUMN "importance" "SourceBlockImportance";
ALTER TABLE "transformer_source_blocks" ADD COLUMN "placement" "SourceBlockPlacement";
ALTER TABLE "transformer_source_blocks" ADD COLUMN "roleReason" TEXT;
ALTER TABLE "transformer_source_blocks" ADD COLUMN "roleConfidence" DOUBLE PRECISION;
ALTER TABLE "transformer_source_blocks" ADD COLUMN "roleStatus" TEXT NOT NULL DEFAULT 'pending';
