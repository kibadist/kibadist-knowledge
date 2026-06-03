// Transformer ingestion size policy (DET-247). The transformer is a separate
// `/transformer` area from the inbox; its paste ceiling is higher (it ingests
// whole articles, not interactive snippets), but PDFs reuse the inbox's
// MAX_PDF_BYTES so the multipart ceiling stays single-sourced.

/** Max characters accepted from a pasted-text transformer source. Spec §Pipeline
 *  1: reject pasted text > 200k chars with 400. */
export const MAX_SOURCE_TEXT_CHARS = 200_000
