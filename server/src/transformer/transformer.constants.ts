// Transformer ingestion size policy (DET-247). The transformer is a separate
// `/transformer` area from the inbox; its paste ceiling is higher (it ingests
// whole articles, not interactive snippets), but PDFs reuse the inbox's
// MAX_PDF_BYTES so the multipart ceiling stays single-sourced.

/** Max characters accepted from a pasted-text transformer source. Spec §Pipeline
 *  1: reject pasted text > 200k chars with 400. */
export const MAX_SOURCE_TEXT_CHARS = 200_000

/** Generation size for rendered illustrations (DET-261). gpt-image-1 has no
 *  native 16:9 size, so we generate at its widest landscape (1536×1024, 3:2)
 *  and present it in a 16:9 figure frame on the client (object-fit: cover). */
export const ILLUSTRATION_IMAGE_SIZE = '1536x1024' as const

/**
 * House art direction for EVERY rendered illustration — mid-century scientific
 * illustration, the editorial-manuscript brand's visual register (spec §8.5:
 * minimal scientific diagram / premium magazine illustration, never generic AI
 * art). Applied at the RENDER boundary so the auto-render and the manual
 * approve→render path produce one consistent plate language; the planner's
 * visualDescription describes CONTENT only and must not fight this.
 */
export const ILLUSTRATION_STYLE =
  'Style: mid-century scientific illustration (1950s–60s textbook plate). ' +
  'Flat gouache and ink, muted limited palette (warm cream paper, ochre, ' +
  'teal, vermilion, charcoal), precise linework, clean geometric forms, ' +
  'subtle paper grain, screen-print texture. Calm, instructive, elegant. ' +
  'No photorealism, no 3D render, no neon or gradients, no cartoon mascots, ' +
  'and no text, labels, or lettering in the image.'

/** The one image prompt both render paths use: the approved suggestion's own
 *  text (never source blocks) + the house style directive. */
export function buildIllustrationImagePrompt(
  visualDescription: string,
  caption: string,
): string {
  return `${visualDescription}\n\nCaption: ${caption}\n\n${ILLUSTRATION_STYLE}`
}
