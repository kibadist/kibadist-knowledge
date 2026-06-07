import type { CaptureSource } from '@/lib/api'
// Humanized labels (DET-304): one source of truth for every enum label.
import { CAPTURE_SOURCE_LABELS } from '@/lib/labels'

import { isLexicalStateJSON } from '../editor/editor-state'

/**
 * Reader content helpers (DET-209).
 *
 * The Reader renders *source / reference* material — never earned knowledge.
 * Source text reaches us in three shapes:
 *   1. Serialized Lexical state JSON (rich, structured) — rendered as-is.
 *   2. Markdown or plain text with real line breaks (e.g. pasted) — parsed into
 *      structured nodes so headings/lists/quotes/code render properly.
 *   3. A whitespace-collapsed run-on blob (URL/PDF capture strips structure on
 *      the server) — renders honestly as flowing prose in the reading column.
 *
 * We never fabricate structure the source doesn't have: a run-on blob stays one
 * paragraph. The "beautiful" win for unstructured text comes from typography,
 * measure, and rhythm — not invented headings.
 */

/** True when the content is a serialized Lexical document (render via state). */
export function looksLikeLexicalState(content: string): boolean {
  return isLexicalStateJSON(content)
}

/** True when there is something worth rendering (after trimming). */
export function hasReadableContent(
  content: string | null | undefined,
): content is string {
  return typeof content === 'string' && content.trim().length > 0
}

/**
 * Normalize free text before handing it to the markdown converter. We collapse
 * runs of 3+ blank lines to a single paragraph break and trim the ends, but we
 * do NOT inject paragraph breaks that aren't there — unstructured source stays
 * unstructured rather than being dressed up as something it isn't.
 */
export function prepareMarkdown(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Human label for where this source came from. */
export function captureSourceLabel(
  source: CaptureSource | null | undefined,
): string | null {
  return source ? (CAPTURE_SOURCE_LABELS[source] ?? null) : null
}

/** Display the host of a source URL (full URL is kept as the link target). */
export function hostLabel(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** A short, human date for the capture timestamp ("May 29, 2026"). */
export function readableDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** A heading discovered in the rendered document, used to build the TOC. */
export interface ReaderHeading {
  /** DOM id assigned to the heading element so the TOC can scroll to it. */
  id: string
  /** Visible heading text. */
  text: string
  /** Heading level (1–3). */
  level: number
  /** Lexical node key used to locate the DOM element. */
  nodeKey: string
}
