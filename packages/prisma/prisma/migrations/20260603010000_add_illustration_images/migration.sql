-- NOTE: the `DROP INDEX "articulation_embedding_hnsw_idx"` line that Prisma's
-- diff emits has been intentionally stripped — that HNSW index is hand-written
-- raw SQL Prisma sees as drift (see schema.prisma migration landmine comment).

-- CreateTable
CREATE TABLE "transformer_illustration_images" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mediaType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformer_illustration_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transformer_illustration_images_articleId_suggestionId_key" ON "transformer_illustration_images"("articleId", "suggestionId");

-- AddForeignKey
ALTER TABLE "transformer_illustration_images" ADD CONSTRAINT "transformer_illustration_images_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "transformed_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
