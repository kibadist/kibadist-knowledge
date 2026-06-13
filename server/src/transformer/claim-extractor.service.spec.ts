import type { AiService } from '../ai/ai.service'
import { systemsArticle } from './__fixtures__/systems-article'
import { transformerTranscript } from './__fixtures__/transformer-transcript'
import { ClaimExtractorService } from './claim-extractor.service'
import { ArticleJsonV2Schema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleJsonV2 } from './transformer.types'

/** A service whose AI returns the recorded JSON reply (NO live LLM). */
function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return { service: new ClaimExtractorService(ai), complete }
}

/** Does some extracted claim's text contain ALL of the given substrings (ci)? */
function hasClaimMatching(
  claims: { text: string }[],
  ...needles: string[]
): boolean {
  return claims.some((c) => {
    const t = c.text.toLowerCase()
    return needles.every((n) => t.includes(n.toLowerCase()))
  })
}

describe('ClaimExtractorService', () => {
  describe('systems-article fixture (acceptance: DET-352)', () => {
    it('extracts the definition, boundary distinction, classification, and transformation claim — all grounded + section-mapped', async () => {
      const { service } = makeService(systemsArticle.claimLlm)
      const claims = await service.extract(
        systemsArticle.article,
        systemsArticle.blocks,
      )

      // The four required claims are present.
      expect(hasClaimMatching(claims, 'system', 'components', 'whole')).toBe(
        true,
      )
      expect(hasClaimMatching(claims, 'boundary', 'environment')).toBe(true)
      expect(hasClaimMatching(claims, 'open', 'closed', 'isolated')).toBe(true)
      expect(
        hasClaimMatching(claims, 'transformation', 'inputs', 'outputs'),
      ).toBe(true)

      // Definition is extracted EXPLICITLY as its own claimType.
      const definition = claims.find((c) => c.claimType === 'definition')
      expect(definition).toBeDefined()
      expect(definition?.sourceBlockIds).toEqual(['b2'])

      // Every claim is grounded (non-empty source blocks) AND mapped to the
      // article section that renders those blocks (non-empty section ids).
      const bySource: Record<string, string[]> = {
        b2: ['s1'],
        b3: ['s1'],
        b4: ['s2'],
        b5: ['s2'],
      }
      for (const c of claims) {
        expect(c.sourceBlockIds.length).toBeGreaterThan(0)
        expect(c.articleSectionIds.length).toBeGreaterThan(0)
        expect(c.id).toBeTruthy()
        expect(c.confidence).toBeGreaterThanOrEqual(0)
        expect(c.confidence).toBeLessThanOrEqual(1)
        // The derived section ids match the sections holding the cited blocks.
        expect(c.articleSectionIds).toEqual(bySource[c.sourceBlockIds[0]])
      }
    })

    it('produces keyClaims that validate on the article schema', () => {
      const article: ArticleJsonV2 = {
        ...systemsArticle.article,
        keyClaims: [
          {
            id: 'k1',
            text: 'A system is an integrated whole of interacting components.',
            sourceBlockIds: ['b2'],
            articleSectionIds: ['s1'],
            claimType: 'definition',
            confidence: 0.9,
          },
        ],
      }
      const result = ArticleJsonV2Schema.safeParse(article)
      if (!result.success) {
        throw new Error(JSON.stringify(result.error.issues, null, 2))
      }
      expect(result.success).toBe(true)
    })
  })

  describe('transformer-transcript fixture (acceptance: DET-352)', () => {
    it('extracts attention, Q/K/V, MLP expansion/gate/down projection, layer norm, and non-linearity claims', async () => {
      const { service } = makeService(transformerTranscript.claimLlm)
      const claims = await service.extract(
        transformerTranscript.article,
        transformerTranscript.blocks,
      )

      expect(hasClaimMatching(claims, 'attention', 'token')).toBe(true)
      expect(hasClaimMatching(claims, 'queries', 'keys', 'values')).toBe(true)
      expect(
        hasClaimMatching(claims, 'up projection', 'gate', 'down projection'),
      ).toBe(true)
      expect(hasClaimMatching(claims, 'layer normalization')).toBe(true)
      expect(hasClaimMatching(claims, 'non-linearity')).toBe(true)

      // Section mapping follows the article: attention/QKV → s1, MLP +
      // non-linearity → s2, layer norm → s3.
      const bySource: Record<string, string[]> = {
        b2: ['s1'],
        b3: ['s1'],
        b4: ['s2'],
        b5: ['s2'],
        b6: ['s3'],
      }
      for (const c of claims) {
        expect(c.articleSectionIds).toEqual(bySource[c.sourceBlockIds[0]])
      }
    })
  })

  describe('code guards', () => {
    const blocks: ClassifiedBlockInput[] = [
      {
        id: 'b1',
        type: 'PARAGRAPH',
        classification: 'DEFINITION',
        text: 'real',
        removable: false,
      },
    ]
    const article: ArticleJsonV2 = {
      schemaVersion: 'v2',
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections: [
        {
          id: 's1',
          heading: 'S',
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

    it('drops claims with empty or unknown source block ids', async () => {
      const { service } = makeService({
        claims: [
          {
            text: 'empty',
            sourceBlockIds: [],
            claimType: 'mechanism',
            confidence: 0.5,
          },
          {
            text: 'ghost',
            sourceBlockIds: ['nope'],
            claimType: 'mechanism',
            confidence: 0.5,
          },
          {
            text: 'good',
            sourceBlockIds: ['b1'],
            claimType: 'definition',
            confidence: 0.5,
          },
        ],
      })
      const claims = await service.extract(article, blocks)
      expect(claims).toHaveLength(1)
      expect(claims[0].text).toBe('good')
      expect(claims[0].articleSectionIds).toEqual(['s1'])
    })

    it('drops a claim whose only block is cited by no section', async () => {
      // bOrphan is a real source block but the article renders nothing from it,
      // so the claim has no home section and is dropped.
      const orphanBlocks: ClassifiedBlockInput[] = [
        ...blocks,
        {
          id: 'bOrphan',
          type: 'PARAGRAPH',
          classification: 'CORE',
          text: 'orphan',
          removable: false,
        },
      ]
      const { service } = makeService({
        claims: [
          {
            text: 'orphaned',
            sourceBlockIds: ['bOrphan'],
            claimType: 'mechanism',
            confidence: 0.5,
          },
        ],
      })
      const claims = await service.extract(article, orphanBlocks)
      expect(claims).toEqual([])
    })

    it('clamps confidence into 0–1 and mints ids', async () => {
      const { service } = makeService({
        claims: [
          {
            text: 'hot',
            sourceBlockIds: ['b1'],
            claimType: 'definition',
            confidence: 9,
          },
          {
            text: 'cold',
            sourceBlockIds: ['b1'],
            claimType: 'caveat',
            confidence: -3,
          },
        ],
      })
      const claims = await service.extract(article, blocks)
      expect(claims).toHaveLength(2)
      expect(claims[0].confidence).toBe(1)
      expect(claims[1].confidence).toBe(0)
      expect(new Set(claims.map((c) => c.id)).size).toBe(2)
    })
  })
})
