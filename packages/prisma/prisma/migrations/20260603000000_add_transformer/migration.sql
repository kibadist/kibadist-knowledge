-- CreateEnum
CREATE TYPE "TransformerSourceType" AS ENUM ('TEXT', 'URL', 'PDF');

-- CreateEnum
CREATE TYPE "TransformerSourceStatus" AS ENUM ('INGESTED', 'EXTRACTING', 'EXTRACTED', 'SEGMENTED', 'CLASSIFYING', 'READY', 'EXTRACTION_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransformerBlockType" AS ENUM ('HEADING', 'PARAGRAPH', 'LIST', 'QUOTE', 'TABLE', 'CODE', 'CAPTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TransformerBlockClass" AS ENUM ('MAIN_ARGUMENT', 'DEFINITION', 'EXAMPLE', 'EVIDENCE', 'METHOD', 'BACKGROUND', 'SIDEBAR', 'CITATION', 'NAVIGATION_NOISE', 'ADVERTISEMENT', 'FOOTER', 'DUPLICATE', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "TransformedArticleStatus" AS ENUM ('QUEUED', 'MODELING', 'PLANNING', 'GENERATING', 'CHECKING', 'FINAL', 'BLOCKED', 'FAILED');

-- CreateTable
CREATE TABLE "transformer_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransformerSourceType" NOT NULL,
    "status" "TransformerSourceStatus" NOT NULL DEFAULT 'INGESTED',
    "title" TEXT,
    "url" TEXT,
    "fileName" TEXT,
    "rawContent" TEXT,
    "rawFile" BYTEA,
    "metadata" JSONB,
    "extractedText" TEXT,
    "extractionError" TEXT,
    "extractorVersion" TEXT,
    "blocksVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformer_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformer_source_blocks" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "blockType" "TransformerBlockType" NOT NULL,
    "text" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "classification" "TransformerBlockClass",
    "classificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "removable" BOOLEAN NOT NULL DEFAULT false,
    "noiseReason" TEXT,

    CONSTRAINT "transformer_source_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformed_articles" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "blocksVersion" INTEGER NOT NULL,
    "status" "TransformedArticleStatus" NOT NULL DEFAULT 'QUEUED',
    "structureModel" JSONB,
    "reshapingPlan" JSONB,
    "articleJson" JSONB,
    "fidelityReport" JSONB,
    "fidelityScore" INTEGER,
    "coverageReport" JSONB,
    "illustrationPlan" JSONB,
    "learningLayer" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformed_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transformer_sources_workspaceId_idx" ON "transformer_sources"("workspaceId");

-- CreateIndex
CREATE INDEX "transformer_sources_userId_idx" ON "transformer_sources"("userId");

-- CreateIndex
CREATE INDEX "transformer_sources_workspaceId_status_idx" ON "transformer_sources"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "transformer_source_blocks_sourceId_version_idx" ON "transformer_source_blocks"("sourceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "transformer_source_blocks_sourceId_version_orderIndex_key" ON "transformer_source_blocks"("sourceId", "version", "orderIndex");

-- CreateIndex
CREATE INDEX "transformed_articles_sourceId_idx" ON "transformed_articles"("sourceId");

-- CreateIndex
CREATE INDEX "transformed_articles_workspaceId_idx" ON "transformed_articles"("workspaceId");

-- AddForeignKey
ALTER TABLE "transformer_sources" ADD CONSTRAINT "transformer_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformer_sources" ADD CONSTRAINT "transformer_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformer_source_blocks" ADD CONSTRAINT "transformer_source_blocks_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "transformer_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformed_articles" ADD CONSTRAINT "transformed_articles_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "transformer_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformed_articles" ADD CONSTRAINT "transformed_articles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

