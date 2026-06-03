import type {
  TransformationType,
  TransformedArticleStatus,
  TransformerBlockClass,
  TransformerSourceStatus,
  TransformerSourceType,
} from '@/lib/api'

// --- Source status (the M1 pipeline) ---
// The ordered pipeline steps the source detail view renders as a stepper.
export const SOURCE_PIPELINE_STEPS: {
  key: TransformerSourceStatus
  label: string
}[] = [
  { key: 'INGESTED', label: 'Ingested' },
  { key: 'EXTRACTING', label: 'Extracting' },
  { key: 'SEGMENTED', label: 'Segmented' },
  { key: 'CLASSIFYING', label: 'Classifying' },
  { key: 'READY', label: 'Ready' },
]

// Map the live status onto a step index for the stepper (EXTRACTED collapses
// into Extracting→Segmented; failures stop the line where they happened).
const SOURCE_STEP_INDEX: Record<TransformerSourceStatus, number> = {
  INGESTED: 0,
  EXTRACTING: 1,
  EXTRACTED: 1,
  SEGMENTED: 2,
  CLASSIFYING: 3,
  READY: 4,
  EXTRACTION_FAILED: 1,
  FAILED: 0,
}

export function sourceStepIndex(status: TransformerSourceStatus): number {
  return SOURCE_STEP_INDEX[status] ?? 0
}

// A source is "settled" (stop polling) at READY or any failure.
export function isSourceTerminal(status: TransformerSourceStatus): boolean {
  return (
    status === 'READY' || status === 'EXTRACTION_FAILED' || status === 'FAILED'
  )
}

export function sourceStatusLabel(status: TransformerSourceStatus): string {
  switch (status) {
    case 'INGESTED':
      return 'Ingested'
    case 'EXTRACTING':
      return 'Extracting'
    case 'EXTRACTED':
      return 'Extracted'
    case 'SEGMENTED':
      return 'Segmented'
    case 'CLASSIFYING':
      return 'Classifying'
    case 'READY':
      return 'Ready'
    case 'EXTRACTION_FAILED':
      return 'Extraction failed'
    case 'FAILED':
      return 'Failed'
  }
}

// Chip tone class (reuses the .kbapp chip palette).
export function sourceStatusChip(status: TransformerSourceStatus): string {
  if (status === 'READY') return 'chip-cleared'
  if (status === 'EXTRACTION_FAILED' || status === 'FAILED')
    return 'chip-contested'
  return 'chip-pending'
}

export function sourceTypeLabel(type: TransformerSourceType): string {
  switch (type) {
    case 'TEXT':
      return 'Text'
    case 'URL':
      return 'Link'
    case 'PDF':
      return 'PDF'
  }
}

export function sourceTypeMark(type: TransformerSourceType): string {
  switch (type) {
    case 'TEXT':
      return '¶'
    case 'URL':
      return '↗'
    case 'PDF':
      return '▤'
  }
}

// --- Article status (Wave B generation) ---
export const ARTICLE_TERMINAL: TransformedArticleStatus[] = [
  'FINAL',
  'BLOCKED',
  'FAILED',
]

export function isArticleTerminal(status: TransformedArticleStatus): boolean {
  return ARTICLE_TERMINAL.includes(status)
}

export function articleStatusLabel(status: TransformedArticleStatus): string {
  switch (status) {
    case 'QUEUED':
      return 'Queued'
    case 'MODELING':
      return 'Modeling the source'
    case 'PLANNING':
      return 'Planning the reshaping'
    case 'GENERATING':
      return 'Generating the article'
    case 'CHECKING':
      return 'Checking fidelity'
    case 'FINAL':
      return 'Final'
    case 'BLOCKED':
      return 'Blocked'
    case 'FAILED':
      return 'Failed'
  }
}

export function articleStatusChip(status: TransformedArticleStatus): string {
  if (status === 'FINAL') return 'chip-cleared'
  if (status === 'BLOCKED' || status === 'FAILED') return 'chip-contested'
  return 'chip-pending'
}

// The ordered in-progress steps for the article generation progress bar.
export const ARTICLE_STEPS: TransformedArticleStatus[] = [
  'QUEUED',
  'MODELING',
  'PLANNING',
  'GENERATING',
  'CHECKING',
]

export function articleStepIndex(status: TransformedArticleStatus): number {
  const i = ARTICLE_STEPS.indexOf(status)
  if (i >= 0) return i
  // Terminal states sit past the last step.
  return ARTICLE_STEPS.length
}

// --- Block classification ---
export function blockClassLabel(
  classification: string | TransformerBlockClass | null,
): string {
  if (!classification) return 'Unclassified'
  return classification
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

// The substance classes — rendered as the positive/signal tone.
const SIGNAL_CLASSES = new Set([
  'MAIN_ARGUMENT',
  'DEFINITION',
  'EXAMPLE',
  'EVIDENCE',
  'METHOD',
])
const NOISE_CLASSES = new Set([
  'NAVIGATION_NOISE',
  'ADVERTISEMENT',
  'FOOTER',
  'DUPLICATE',
])

export function blockClassChip(classification: string | null): string {
  if (!classification) return 'chip-quiet'
  if (classification === 'UNCERTAIN') return 'chip-pending'
  if (SIGNAL_CLASSES.has(classification)) return 'chip-cleared'
  if (NOISE_CLASSES.has(classification)) return 'chip-contested'
  return 'chip-info'
}

// --- Transformation type + fidelity risk (source inspector, DET-257) ---
export function transformationTypeLabel(type: TransformationType): string {
  switch (type) {
    case 'verbatim':
      return 'Verbatim'
    case 'grammar_cleanup':
      return 'Grammar cleanup'
    case 'light_reword':
      return 'Light reword'
    case 'paragraph_split':
      return 'Paragraph split'
    case 'paragraph_merge':
      return 'Paragraph merge'
    case 'formatting_only':
      return 'Formatting only'
  }
}

export function fidelityRiskChip(risk: 'low' | 'medium' | 'high'): string {
  if (risk === 'low') return 'chip-cleared'
  if (risk === 'medium') return 'chip-pending'
  return 'chip-contested'
}

export function severityChip(sev: 'low' | 'medium' | 'high'): string {
  if (sev === 'low') return 'chip-quiet'
  if (sev === 'medium') return 'chip-pending'
  return 'chip-contested'
}

// Build a human source-location line for a block (page / chars / kind).
export function blockLocationLine(block: {
  pageNumber: number | null
  charStart: number | null
  charEnd: number | null
}): string | null {
  const parts: string[] = []
  if (block.pageNumber != null) parts.push(`Page ${block.pageNumber}`)
  if (block.charStart != null && block.charEnd != null)
    parts.push(`chars ${block.charStart}–${block.charEnd}`)
  return parts.length ? parts.join(' · ') : null
}

export function readableDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
