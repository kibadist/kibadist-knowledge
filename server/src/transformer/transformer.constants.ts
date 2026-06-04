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
