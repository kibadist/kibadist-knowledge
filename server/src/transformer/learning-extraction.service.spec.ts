import type { AiService } from '../ai/ai.service'
import {
  conceptExtractionFixtures,
  systemsArticleFixture,
  transformerTranscriptFixture,
} from './__fixtures__/concept-extraction'
import { LearningLayerService } from './learning-layer.service'
import { ArticleJsonV2Schema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleJsonV2 } from './transformer.types'

/** A service whose LLM returns `response` verbatim (the recorded extraction). */
function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return { service: new LearningLayerService(ai), complete }
}

// --- DET-351: whole-article concept extraction ------------------------------

describe('LearningLayerService.extractArticleConcepts (DET-351)', () => {
  describe('acceptance-criteria fixtures', () => {
    it('the fixture articles are valid ArticleJsonV2', () => {
      for (const f of conceptExtractionFixtures) {
        expect(() => ArticleJsonV2Schema.parse(f.article)).not.toThrow()
      }
    })

    it('the transformer transcript produces at least 8 concept candidates', async () => {
      const { service } = makeService(transformerTranscriptFixture.llmResponse)
      const out = await service.extractArticleConcepts(
        transformerTranscriptFixture.article,
        transformerTranscriptFixture.blocks,
      )
      expect(out.length).toBeGreaterThanOrEqual(8)
    })

    it('the systems article produces at least 10 concept candidates', async () => {
      const { service } = makeService(systemsArticleFixture.llmResponse)
      const out = await service.extractArticleConcepts(
        systemsArticleFixture.article,
        systemsArticleFixture.blocks,
      )
      expect(out.length).toBeGreaterThanOrEqual(10)
    })

    it('every candidate carries source references AND resolved article section ids', async () => {
      for (const f of conceptExtractionFixtures) {
        const { service } = makeService(f.llmResponse)
        const out = await service.extractArticleConcepts(f.article, f.blocks)
        const knownBlocks = new Set(f.blocks.map((b) => b.id))
        for (const c of out) {
          expect(c.sourceBlockIds.length).toBeGreaterThan(0)
          // grounding: every cited block is a real source block
          for (const id of c.sourceBlockIds)
            expect(knownBlocks.has(id)).toBe(true)
          // section ids are resolved (these fixtures cite every block in a section)
          expect(c.articleSectionIds.length).toBeGreaterThan(0)
        }
      }
    })

    it('deduplicates by normalized name (the recorded duplicate collapses)', async () => {
      const { service } = makeService(transformerTranscriptFixture.llmResponse)
      const out = await service.extractArticleConcepts(
        transformerTranscriptFixture.article,
        transformerTranscriptFixture.blocks,
      )
      const names = out.map((c) => c.normalizedName)
      expect(new Set(names).size).toBe(names.length)
      // "Self-attention" + "Self Attention" collapse to one merged candidate.
      expect(names.filter((n) => n === 'self attention')).toHaveLength(1)
    })

    it('marks high-importance candidates eligible for Concept Library review', async () => {
      const { service } = makeService(systemsArticleFixture.llmResponse)
      const out = await service.extractArticleConcepts(
        systemsArticleFixture.article,
        systemsArticleFixture.blocks,
      )
      for (const c of out) {
        expect(c.eligibleForLibraryReview).toBe(c.importance === 'high')
      }
      expect(out.some((c) => c.eligibleForLibraryReview)).toBe(true)
    })

    it('never auto-promotes: every candidate is pending, aiAssisted, unlinked', async () => {
      for (const f of conceptExtractionFixtures) {
        const { service } = makeService(f.llmResponse)
        const out = await service.extractArticleConcepts(f.article, f.blocks)
        for (const c of out) {
          expect(c.validationStatus).toBe('pending')
          expect(c.aiAssisted).toBe(true)
          expect(c.conceptId).toBeUndefined()
        }
      }
    })

    it('resolves relationship edges to real candidates and drops dangling/ungrounded targets', async () => {
      const { service } = makeService(systemsArticleFixture.llmResponse)
      const out = await service.extractArticleConcepts(
        systemsArticleFixture.article,
        systemsArticleFixture.blocks,
      )
      const names = new Set(out.map((c) => c.normalizedName))
      for (const c of out) {
        for (const r of c.relationshipCandidates ?? []) {
          expect(names.has(r.targetNormalizedName)).toBe(true)
          expect(r.targetNormalizedName).not.toBe(c.normalizedName)
        }
      }
      // The open/closed-system contrast survived as a resolved edge.
      const open = out.find((c) => c.normalizedName === 'open system')
      expect(
        open?.relationshipCandidates?.some(
          (r) =>
            r.type === 'contrasts_with' &&
            r.targetNormalizedName === 'closed system',
        ),
      ).toBe(true)
    })
  })

  describe('code guards', () => {
    const blocks: ClassifiedBlockInput[] = [
      {
        id: 'b1',
        type: 'PARAGRAPH',
        classification: 'CORE',
        text: 'real',
        removable: false,
      },
      {
        id: 'b2',
        type: 'PARAGRAPH',
        classification: 'NOISE',
        text: 'filler',
        removable: true,
      },
    ]

    function oneBlockArticle(): ArticleJsonV2 {
      return {
        schemaVersion: 'v2',
        mode: 'source_preserving_article',
        title: { text: 'T', source: 'original' },
        abstract: [],
        sections: [
          {
            id: 's1',
            heading: 'H',
            headingSource: 'original',
            sourceBlockIds: ['b1'],
            blocks: [
              {
                id: 'p1',
                type: 'paragraph',
                text: 'real',
                sourceBlockIds: ['b1'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
            ],
          },
        ],
        keyTerms: [],
        sourceExamples: [],
        caveats: [],
        originalStructure: [],
      }
    }

    it('drops ungrounded candidates and ones citing unknown block ids', async () => {
      const { service } = makeService({
        candidates: [
          { name: 'Empty', sourceBlockIds: [], relationships: [] },
          { name: 'Ghost', sourceBlockIds: ['nope'], relationships: [] },
          { name: 'Good', sourceBlockIds: ['b1'], relationships: [] },
        ],
      })
      const out = await service.extractArticleConcepts(
        oneBlockArticle(),
        blocks,
      )
      expect(out).toHaveLength(1)
      expect(out[0].name).toBe('Good')
      expect(out[0].normalizedName).toBe('good')
    })

    it('falls back to safe enum values for off-taxonomy type/importance/state', async () => {
      const { service } = makeService({
        candidates: [
          {
            name: 'X',
            type: 'totally-bogus',
            importance: 'critical',
            suggestedCognitiveState: 'Mastered',
            sourceBlockIds: ['b1'],
            relationships: [],
          },
        ],
      })
      const out = await service.extractArticleConcepts(
        oneBlockArticle(),
        blocks,
      )
      expect(out).toHaveLength(1)
      expect(out[0].type).toBe('term')
      expect(out[0].importance).toBe('medium')
      expect(out[0].suggestedCognitiveState).toBe('Seen')
    })

    it('drops relationship edges with unknown kinds', async () => {
      const { service } = makeService({
        candidates: [
          {
            name: 'A',
            sourceBlockIds: ['b1'],
            relationships: [{ type: 'depends_on', targetName: 'B' }],
          },
          { name: 'B', sourceBlockIds: ['b1'], relationships: [] },
        ],
      })
      const out = await service.extractArticleConcepts(
        oneBlockArticle(),
        blocks,
      )
      const a = out.find((c) => c.normalizedName === 'a')
      expect(a?.relationshipCandidates).toBeUndefined()
    })

    it('returns [] without calling the LLM when there are no real blocks', async () => {
      const { service, complete } = makeService({ candidates: [] })
      const out = await service.extractArticleConcepts(oneBlockArticle(), [
        blocks[1], // the only block is removable noise
      ])
      expect(out).toEqual([])
      expect(complete).not.toHaveBeenCalled()
    })
  })
})
