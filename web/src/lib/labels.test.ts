import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CAPTURE_SOURCE_LABELS,
  CERTAINTY_LABELS,
  COGNITIVE_STATE_LABELS,
  CONCEPT_STATUS_LABELS,
  FRICTION_LEVEL_LABELS,
  GATE_MODE_LABELS,
  LINK_RELATION_LABELS,
  LINK_STATUS_LABELS,
  LIVING_CONCEPT_STATUS_LABELS,
  REFLECTION_KIND_LABELS,
  SESSION_ITEM_REASON_LABELS,
} from '@/lib/labels'

// DET-304. Two guarantees, both cheap:
//   1. Every label map is exhaustive for its enum and never echoes a raw
//      SHOUTING value back to the screen.
//   2. No screen renders a raw enum directly — every in-scope render routes
//      through a label map. This is the grep-guard the ticket asks for: it fails
//      loudly the moment someone reintroduces `{concept.cognitiveState}` etc.

// vitest runs with the web workspace as cwd (vitest.config.ts root).
const srcDir = join(process.cwd(), 'src')

// The enum members, mirrored from api.ts. If the server adds a member, the map
// is missing a key and this test fails — the intended drift alarm.
const ENUMS: Record<string, { map: Record<string, string>; keys: string[] }> = {
  CognitiveState: {
    map: COGNITIVE_STATE_LABELS,
    keys: [
      'SEEN',
      'PARSED',
      'EXPLAINED',
      'LINKED',
      'RETRIEVED',
      'DEFENDED',
      'INTERNALIZED',
      'DORMANT',
      'CONTESTED',
      'ARCHIVED',
    ],
  },
  Certainty: {
    map: CERTAINTY_LABELS,
    keys: ['ASSERTED', 'TENTATIVE', 'UNCERTAIN'],
  },
  GateMode: { map: GATE_MODE_LABELS, keys: ['QUICK', 'DEEP'] },
  CaptureSource: {
    map: CAPTURE_SOURCE_LABELS,
    keys: ['PASTE', 'URL', 'PDF'],
  },
  ConceptStatus: {
    map: CONCEPT_STATUS_LABELS,
    keys: ['INBOX', 'ARTICULATED', 'PERMANENT'],
  },
  FrictionLevel: {
    map: FRICTION_LEVEL_LABELS,
    keys: ['MINIMAL', 'LIGHT', 'DEEP', 'RIGOROUS'],
  },
  LinkStatus: {
    map: LINK_STATUS_LABELS,
    keys: ['SUGGESTED', 'CONFIRMED', 'REJECTED'],
  },
  LinkRelation: {
    map: LINK_RELATION_LABELS,
    keys: [
      'ANALOGY',
      'CONTRADICTION',
      'SUPPORTS',
      'DEPENDS_ON',
      'REFINES',
      'REDUNDANT',
    ],
  },
  LivingConceptStatus: {
    map: LIVING_CONCEPT_STATUS_LABELS,
    keys: ['DRAFT', 'USER_VALIDATED', 'ARCHIVED'],
  },
  SessionItemReason: {
    map: SESSION_ITEM_REASON_LABELS,
    keys: ['DUE', 'CONTESTED', 'REDISCOVERY', 'CHALLENGE'],
  },
  ReflectionKind: {
    map: REFLECTION_KIND_LABELS,
    keys: ['CLEARER', 'LESS_CLEAR', 'CONNECTED', 'CHALLENGE_NEXT'],
  },
}

describe('enum label maps', () => {
  for (const [name, { map, keys }] of Object.entries(ENUMS)) {
    it(`${name} covers every member exactly`, () => {
      expect(Object.keys(map).sort()).toEqual([...keys].sort())
    })

    it(`${name} never renders a raw SHOUTING value`, () => {
      for (const [key, value] of Object.entries(map)) {
        // A humanized label is not its own key and is not an ALL_CAPS enum token
        // (e.g. "DEPENDS_ON"). Mixed-case acronyms like "PDF document" pass.
        expect(value).not.toBe(key)
        expect(value).not.toMatch(/^[A-Z][A-Z_]+$/)
      }
    })
  }
})

describe('no raw enum leaks in JSX', () => {
  // Files that render these enums. A raw render ends the property access with
  // `}` (a JSX child or string-attr value); routing through a label map ends it
  // with `]` (a map lookup), so this regex only catches the un-humanized form.
  const FILES = [
    'app/(app)/concepts/page.tsx',
    'app/(app)/concepts/[id]/page.tsx',
    'app/(app)/inbox/[id]/promote/page.tsx',
    'app/(app)/session/page.tsx',
    'components/graph/graph-inspector.tsx',
    'components/graph/concept-graph-canvas.tsx',
  ]
  const FORBIDDEN =
    /\.(cognitiveState|certainty|gateMode|relationKind|status|level)\}/g

  for (const rel of FILES) {
    it(`${rel} routes every enum through a label map`, () => {
      const source = readFileSync(`${srcDir}/${rel}`, 'utf8')
      const hits = source.match(FORBIDDEN) ?? []
      expect(hits).toEqual([])
    })
  }
})
