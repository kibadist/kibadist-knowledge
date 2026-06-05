# Generated Article Learning Modes — shared contract (DET-278)

This module is the **executable coordination contract** for the Generated
Article Learning Modes project. It exists so every mode ticket builds on the same
IDs, the same event log, the same scheduling rule, and the same provenance model
instead of re-deriving them. Read DET-278 for the prose; this directory is the
machine-checked version of it.

Import everything from the barrel:

```ts
import {
  ArticleJsonV2,
  ArticleLearningEvent,
  decidePromptScheduling,
  resolveSourceConfidence,
  stampArticleIds,
  eventsForMode,
} from '../article-learning'
```

## What's here

| File | Contract it pins |
| --- | --- |
| `article-learning.types.ts` | Article JSON v2 shape; `ArticleLearningEvent`; the three vocabularies (`ArticleLearningEventType`, `ReviewPromptStatus`, `SourceConfidence`) |
| `article-id.util.ts` | Stable `article_id` / `section_id` / `block_id` minting — once, persisted, never recomputed on render (rule #1) |
| `prompt-scheduling.ts` | `decidePromptScheduling` — the strict auto-schedule rule; default is `suggested` (rule #4) |
| `source-provenance.ts` | `resolveSourceConfidence` — three layers never collapsed; the UI label vocabulary (rule #5) |
| `event-mode-map.ts` | Which `article_learning_events` each mode (DET-280…288) may emit |

The persistence side is the `ArticleLearningEvent` Prisma model
(`article_learning_event` table) plus the `ArticleLearningEventType`,
`ReviewPromptStatus`, and `SourceConfidence` enums. `contract-sync.spec.ts`
fails if the Prisma enums ever drift from the TS unions.

## The boundaries that must hold

- **IDs are persisted, never re-derived on render.** Learning events anchor to
  `articleId` + `articleVersionId` + `sectionId`/`blockId`, never to array
  indexes. A material regeneration mints a new `article_id`.
- **`article_learning_events` is the source of truth for user activity** — not
  the article JSON, not the Concept Library. Downstream systems *consume*
  selected events; they never own them.
- **User answers are stored verbatim** (`userAnswer`). AI output is stored as
  **structured** data (`aiFeedback`), never only prose. Compared-block text is
  snapshotted so later article edits can't invalidate history.
- **AI proposes review; the user validates what gets scheduled.** Prompts are
  `suggested` unless the full auto-schedule conjunction holds.
- **Provenance decides trust.** Matching the generated article is *not* the same
  as being source-supported — `article_supported_source_unavailable` keeps the
  two apart, and undeterminable claims are `needs_review`, never a guess.

## Event-to-mode mapping

```
DET-280 Key-Term Overview     → overview_viewed
DET-282 Predict Before Reveal → prediction_submitted, section_revealed, comparison_generated
DET-285 Rewrite-the-Block     → block_rewrite_started, rewrite_peeked, block_rewrite_submitted
DET-286 Compare & Repair      → comparison_generated, rewrite_revised
DET-287 Concept Extraction    → concept_candidate_approved
DET-288 Spaced Review         → review_prompt_approved, review_completed
```

DET-284 Deep Reading is the host reading surface; it owns no events of its own —
it hosts the entry-points into the other modes.
