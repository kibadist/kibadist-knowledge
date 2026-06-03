// Shared formatting for inbox/capture surfaces (DET-241): the list view and the
// focused processing session both render the same source + read-time signal, so
// the helpers live here rather than being duplicated per screen.
import type { CaptureSource } from '@/lib/api'

const WORDS_PER_MINUTE = 200

export const SOURCE_LABEL: Record<CaptureSource, string> = {
  PASTE: 'Paste',
  URL: 'Link',
  PDF: 'PDF',
}

/** Bare hostname for a captured link, used as a row's at-a-glance source marker. */
export function domainOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** What to show as the source marker: the domain for links, else the mode. */
export function sourceMark(item: {
  sourceUrl: string | null
  captureSource: CaptureSource | null
}): string {
  return (
    domainOf(item.sourceUrl) ??
    (item.captureSource ? SOURCE_LABEL[item.captureSource] : 'Capture')
  )
}

/** A compact length signal so you can triage by effort ("38 words" vs "12 min"). */
export function lengthLabel(wordCount: number): string | null {
  if (!wordCount) return null
  if (wordCount < 60) return `${wordCount} words`
  return `${Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE))} min`
}

export function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

// Snooze presets (DET-241). Computed in the user's local timezone and sent to
// the server as ISO datetimes — "tomorrow" means tomorrow morning where the user
// is, not where the server is.
export interface SnoozeOption {
  key: string
  label: string
  until: string
}

function atHour(base: Date, addDays: number, hour: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + addDays)
  d.setHours(hour, 0, 0, 0)
  return d
}

export function snoozeOptions(now: Date = new Date()): SnoozeOption[] {
  return [
    {
      key: 'later',
      label: 'Later today',
      until: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      key: 'tomorrow',
      label: 'Tomorrow',
      until: atHour(now, 1, 9).toISOString(),
    },
    {
      key: 'nextweek',
      label: 'Next week',
      until: atHour(now, 7, 9).toISOString(),
    },
  ]
}

/** The quick default (keyboard "S") — tomorrow morning. */
export function defaultSnoozeUntil(now: Date = new Date()): string {
  return atHour(now, 1, 9).toISOString()
}
