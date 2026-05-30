-- Understanding Sessions (DET-198). NOTE: the spurious `DROP INDEX
-- "articulation_embedding_hnsw_idx"` Prisma generates was removed (HNSW landmine).

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SessionItemReason" AS ENUM ('DUE', 'CONTESTED', 'REDISCOVERY', 'CHALLENGE');

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "targetMinutes" INTEGER NOT NULL DEFAULT 10,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_item" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reason" "SessionItemReason" NOT NULL DEFAULT 'DUE',
    "reviewedAt" TIMESTAMP(3),
    "recallScore" INTEGER,

    CONSTRAINT "session_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_userId_startedAt_idx" ON "session"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "session_userId_status_idx" ON "session"("userId", "status");

-- CreateIndex
CREATE INDEX "session_item_sessionId_position_idx" ON "session_item"("sessionId", "position");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_item" ADD CONSTRAINT "session_item_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_item" ADD CONSTRAINT "session_item_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
