-- Reflections (DET-196). NOTE: the spurious `DROP INDEX articulation_embedding_hnsw_idx`
-- Prisma generates was removed (HNSW landmine — see schema.prisma).

-- CreateEnum
CREATE TYPE "ReflectionKind" AS ENUM ('CLEARER', 'LESS_CLEAR', 'CONNECTED', 'CHALLENGE_NEXT');

-- AlterTable
ALTER TABLE "concept" ADD COLUMN     "tutorRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reflection" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "kind" "ReflectionKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reflection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reflection_conceptId_createdAt_idx" ON "reflection"("conceptId", "createdAt");

-- CreateIndex
CREATE INDEX "reflection_sessionId_idx" ON "reflection"("sessionId");

-- AddForeignKey
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
