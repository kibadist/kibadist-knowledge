import type { CaptureSource } from '@/lib/api'
import type {
  ArticleBlockV2,
  ArticleSectionV2,
  ArticleV2,
  LearningAffordance,
} from '@/lib/article-v2'

/**
 * Downstream hooks for the active learning modes (DET-284 integration notes).
 *
 * Deep Reading Mode owns the reading surface and the entry points; the actual
 * exercises are implemented by sibling tickets. Each handler receives the
 * stable DET-278 identifiers so the mode it opens can anchor its
 * `article_learning_events` correctly. All handlers are optional — an
 * unimplemented mode simply renders its entry point as "coming soon".
 */
export interface SectionContext {
  article: ArticleV2
  section: ArticleSectionV2
}

export interface BlockContext extends SectionContext {
  block: ArticleBlockV2
}

export interface LearningModeHandlers {
  /** DET-282 Predict Before Reveal. */
  onPredict?: (ctx: SectionContext) => void
  /** DET-285 Rewrite-the-Block (defaults to the section's first text block). */
  onRewrite?: (ctx: BlockContext) => void
  /** DET-287 Concept Extraction. */
  onExtractConcepts?: (ctx: SectionContext) => void
  /** DET-286 Compare & Repair. */
  onCompare?: (ctx: BlockContext) => void
  /** DET-288 Spaced Review. */
  onReview?: (ctx: SectionContext) => void
}

/** Source provenance carried over from the generated-article view (DET-278 §5). */
export interface ArticleProvenance {
  sourceUrl?: string | null
  captureSource?: CaptureSource | null
  /** Whether the original source spans are available behind this article. */
  sourceAvailable?: boolean
}

export type ReadingMode =
  | 'overview'
  | 'deep'
  | 'predict'
  | 'rewrite'
  | 'compare'

/** Maps an affordance to the handler key that implements it. */
export const AFFORDANCE_HANDLER: Record<
  LearningAffordance,
  keyof LearningModeHandlers
> = {
  predict: 'onPredict',
  rewrite: 'onRewrite',
  extract_concepts: 'onExtractConcepts',
  compare: 'onCompare',
  review: 'onReview',
}
