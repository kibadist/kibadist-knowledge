import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ARTICLE_GENERATION_ENV,
  type ArticleGenerationContext,
  type ArticleGenerationFlags,
  LEGACY_MASTER_FLAG_ENV,
  readArticleGenerationFlags,
  routeArticleGeneration,
} from './article-generation-router'
import type {
  ArticleRoutingDecision,
  SourceDiagnosis,
  SourceDiagnosisMetadata,
} from './source-diagnosis.types'
import { diagnoseSource } from './source-diagnosis.util'
import type { ClassifiedBlockInput } from './structure-model.service'

/**
 * Source-diagnosis service (DET-345). Thin injectable wrapper that (a) runs the
 * deterministic diagnosis and (b) applies the feature-flag-gated v3 ROUTING
 * (DET-362) on top of it.
 *
 * Routing follows the ticket's architecture note: v2 is the default fallback for
 * every source, and v3 is selected only when the flags allow it for the detected
 * kind (see `article-generation-router.ts` for the full flag matrix). The diagnosis
 * is computed for EVERY article regardless of routing, so it is available to both
 * pipelines and to analytics; only the pipeline CHOICE is gated.
 */
@Injectable()
export class SourceDiagnosisService {
  constructor(private readonly config: ConfigService) {}

  /** Run the deterministic diagnosis for a source's blocks + metadata. */
  diagnose(
    blocks: ClassifiedBlockInput[],
    metadata: SourceDiagnosisMetadata = {},
  ): SourceDiagnosis {
    return diagnoseSource(blocks, metadata)
  }

  /**
   * Diagnose, then decide which pipeline runs. Pure aside from reading the rollout
   * flags; never throws. `context.internalPreview` lets a preview job opt into v3
   * while the rollout is still in internal-preview-only mode.
   */
  route(
    blocks: ClassifiedBlockInput[],
    metadata: SourceDiagnosisMetadata = {},
    context: ArticleGenerationContext = {},
  ): ArticleRoutingDecision {
    const diagnosis = this.diagnose(blocks, metadata)
    return this.decideRouting(diagnosis, context)
  }

  /** Apply the flag matrix to a diagnosis. Exposed for direct testing. */
  decideRouting(
    diagnosis: SourceDiagnosis,
    context: ArticleGenerationContext = {},
  ): ArticleRoutingDecision {
    const routing = routeArticleGeneration(
      diagnosis.sourceKind,
      this.readFlags(),
      context,
    )
    return {
      pipeline: routing.pipeline,
      diagnosis,
      reason: routing.reason,
      fallbackToV2OnFailure: routing.fallbackToV2OnFailure,
    }
  }

  /**
   * Whether the v3 MASTER gate is on. Off by default; opt-in via
   * `ARTICLE_GENERATION_V3_ENABLED` (legacy alias `TRANSFORMER_V3_ENABLED`). Note a
   * `true` here does NOT mean every source routes to v3 — the per-kind +
   * preview-only flags still apply (see `route`).
   */
  isV3Enabled(): boolean {
    return this.readFlags().v3Enabled
  }

  /** Project the router-relevant env via ConfigService into a flag config. */
  private readFlags(): ArticleGenerationFlags {
    const keys = [
      ...Object.values(ARTICLE_GENERATION_ENV),
      LEGACY_MASTER_FLAG_ENV,
    ]
    const env: Record<string, string | undefined> = {}
    for (const key of keys) env[key] = this.config.get<string>(key)
    return readArticleGenerationFlags(env)
  }
}
