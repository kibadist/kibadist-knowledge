import { Injectable } from '@nestjs/common'

import {
  buildArticleQualityReport,
  type FidelityReviewInput,
} from './fidelity-review.util'
import type { ArticleQualityReportV3 } from './transformer.types'

/**
 * Fidelity-review service (DET-354, pipeline step after learning extraction).
 *
 * It runs for EVERY v3 generation and produces the `ArticleQualityReportV3` — a
 * deterministic SYNTHESIS of the fidelity report, the coverage report, the
 * structure model and the learning layer. There is no LLM call: re-grading the
 * article with the model would be both slow and untrustworthy, so the review is a
 * pure rollup (see `fidelity-review.util.ts`), mirroring how `coverage.util.ts`
 * grades coverage in code.
 *
 * Kept as a NestJS provider (rather than a bare util call site) so the pipeline
 * wires it like every other stage and a future LLM-assisted dimension can be added
 * here without touching the pipeline.
 */
@Injectable()
export class FidelityReviewService {
  review(input: FidelityReviewInput): ArticleQualityReportV3 {
    return buildArticleQualityReport(input)
  }
}
