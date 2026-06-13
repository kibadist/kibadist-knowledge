import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type {
  ArticleRoutingDecision,
  SourceArticleShape,
  SourceDiagnosis,
  SourceDiagnosisMetadata,
  SourceKind,
} from './source-diagnosis.types'
import { diagnoseSource } from './source-diagnosis.util'
import type { ClassifiedBlockInput } from './structure-model.service'

/**
 * Source-diagnosis service (DET-345). Thin injectable wrapper over the pure
 * detector that (a) runs the deterministic diagnosis and (b) applies the
 * feature-flag-gated v3 ROUTING on top of it.
 *
 * Routing follows the ticket's architecture note exactly:
 *  - v2 is the default fallback for every source.
 *  - v3 is selected ONLY when the rollout flag is on AND the detected kind is one
 *    of the two initially-targeted broken kinds (`transcript_lesson`,
 *    `structured_web_article`).
 *  - `unknown` (and every other kind) always stays on v2 — the conservative
 *    source-grounded path with no external enrichment.
 *
 * The diagnosis is computed for EVERY article regardless of routing, so it is
 * available to both pipelines and to analytics; only the pipeline CHOICE is gated.
 */
@Injectable()
export class SourceDiagnosisService {
  private readonly logger = new Logger(SourceDiagnosisService.name)

  /** Kinds the v3 router targets first (the two known-broken source types). */
  private static readonly V3_TARGET_KINDS: ReadonlySet<SourceKind> =
    new Set<SourceKind>(['transcript_lesson', 'structured_web_article'])

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
   * flag; never throws.
   */
  route(
    blocks: ClassifiedBlockInput[],
    metadata: SourceDiagnosisMetadata = {},
  ): ArticleRoutingDecision {
    const diagnosis = this.diagnose(blocks, metadata)
    return this.decideRouting(diagnosis)
  }

  /** Apply the flag + kind gate to a diagnosis. Exposed for direct testing. */
  decideRouting(diagnosis: SourceDiagnosis): ArticleRoutingDecision {
    const v3Enabled = this.isV3Enabled()
    const targeted = SourceDiagnosisService.V3_TARGET_KINDS.has(
      diagnosis.sourceKind,
    )

    if (v3Enabled && targeted) {
      return {
        pipeline: 'v3',
        diagnosis,
        reason: `v3 routing: flag on and ${diagnosis.sourceKind} is a v3-target kind (shape=${shapeLabel(
          diagnosis.articleShape,
        )})`,
      }
    }

    const reason = !v3Enabled
      ? `v2 fallback: v3 rollout flag off (kind=${diagnosis.sourceKind})`
      : `v2 fallback: ${diagnosis.sourceKind} is not a v3-target kind`
    return { pipeline: 'v2', diagnosis, reason }
  }

  /**
   * Whether v3 routing is enabled. Off by default — opt-in via the
   * `TRANSFORMER_V3_ENABLED` env var (truthy: "1"/"true"/"yes"/"on"). This is the
   * single rollout control; an internal preview mode can flip it per-deploy.
   */
  isV3Enabled(): boolean {
    const raw = this.config.get<string>('TRANSFORMER_V3_ENABLED')
    if (!raw) return false
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
  }
}

function shapeLabel(shape: SourceArticleShape | null): string {
  return shape ?? 'source_grounded'
}
