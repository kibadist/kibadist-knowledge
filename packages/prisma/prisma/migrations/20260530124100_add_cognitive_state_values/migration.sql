-- Cognitive state machine (DET-194), part 1 of 2: introduce the new enum values.
--
-- This is split from the backfill/NOT-NULL migration that follows it because
-- Postgres forbids USING a newly-added enum value in the same transaction that
-- added it ("unsafe use of new value"). Adding the values in their own migration
-- commits them first, so the next migration can backfill existing rows to 'SEEN'.

-- CreateEnum
CREATE TYPE "StateTrigger" AS ENUM ('CAPTURE', 'INTAKE_PARSED', 'PROMOTION', 'LINK_CONFIRMED', 'RETRIEVAL_SUCCESS', 'TUTOR_DEFENDED', 'INTERNALIZED', 'DECAYED', 'REACTIVATED', 'CONTRADICTION', 'RESOLVED', 'ARCHIVED');

-- AlterEnum: add the new cognitive states (EXPLAINED, LINKED already existed).
ALTER TYPE "CognitiveState" ADD VALUE 'SEEN';
ALTER TYPE "CognitiveState" ADD VALUE 'PARSED';
ALTER TYPE "CognitiveState" ADD VALUE 'RETRIEVED';
ALTER TYPE "CognitiveState" ADD VALUE 'DEFENDED';
ALTER TYPE "CognitiveState" ADD VALUE 'INTERNALIZED';
ALTER TYPE "CognitiveState" ADD VALUE 'DORMANT';
ALTER TYPE "CognitiveState" ADD VALUE 'CONTESTED';
ALTER TYPE "CognitiveState" ADD VALUE 'ARCHIVED';
