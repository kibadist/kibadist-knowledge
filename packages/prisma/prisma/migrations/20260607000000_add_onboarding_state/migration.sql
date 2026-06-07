-- First-run onboarding state (DET-307): one row per user tracking the guided
-- starter-article walkthrough. Hand-authored (not `migrate dev`-generated) to
-- follow this project's convention and avoid touching the hand-written HNSW vector
-- index Prisma can't model. Purely additive: one new table. The starter ids are
-- plain columns (no FK) so a deleted starter source never cascades into this row.

-- CreateTable
CREATE TABLE "onboarding_state" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "starterSourceId" TEXT,
    "starterArticleId" TEXT,
    "starterConceptId" TEXT,
    "completedSteps" TEXT[],
    "dismissedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_state_userId_key" ON "onboarding_state"("userId");

-- AddForeignKey
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
