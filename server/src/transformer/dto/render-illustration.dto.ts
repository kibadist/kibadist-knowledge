import { IsBoolean, IsOptional } from 'class-validator'

/**
 * POST body for rendering an approved illustration suggestion (DET-261).
 * `confirmHighRisk` is required (server-enforced, 409 otherwise) to render a
 * high-risk (`fidelityRisk === 'high'`) suggestion such as a source-based diagram.
 */
export class RenderIllustrationDto {
  @IsOptional()
  @IsBoolean()
  confirmHighRisk?: boolean
}
