// Single source of truth for capture size policy (DET-187). Keep the multipart
// registration in main.ts, the per-request controller check, and the util caps
// all referencing these so they can't silently drift.

/** Max characters of raw text stored per captured item (URL/PDF extraction). */
export const MAX_RAW_TEXT_CHARS = 50_000

/** Max characters accepted from a pasted-text capture (interactive input). */
export const MAX_PASTE_CHARS = 20_000

/** Hard ceiling for an uploaded PDF. Enforced both at the multipart layer and
 *  re-checked per request in the controller. */
export const MAX_PDF_BYTES = 10_485_760 // 10MB
