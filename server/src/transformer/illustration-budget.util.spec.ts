import { planAutoRender, scoreSuggestion } from './illustration-budget.util'
import type { DiagramSpec, IllustrationSuggestion } from './schemas'

const spec: DiagramSpec = {
  kind: 'flow',
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  edges: [{ from: 'a', to: 'b' }],
}

function sug(p: Partial<IllustrationSuggestion>): IllustrationSuggestion {
  return {
    id: p.id ?? 'id',
    illustrationType: p.illustrationType ?? 'editorial_cover',
    purpose: 'p',
    visualDescription: 'v',
    caption: 'c',
    fidelityRisk: p.fidelityRisk ?? 'low',
    reason: 'r',
    sourceBlockIds: p.sourceBlockIds ?? ['b1'],
    approval: 'pending',
    diagramSpec: p.diagramSpec ?? null,
    ...p,
  }
}

describe('illustration-budget.util', () => {
  describe('scoreSuggestion', () => {
    it('rewards comprehension value and grounding, penalises risk', () => {
      const strong = scoreSuggestion({
        illustrationType: 'mechanism_explanation',
        fidelityRisk: 'low',
        sourceBlockIds: ['1', '2', '3'],
      })
      const weak = scoreSuggestion({
        illustrationType: 'editorial_cover',
        fidelityRisk: 'medium',
        sourceBlockIds: ['1'],
      })
      expect(strong).toBeGreaterThan(weak)
    })

    it('caps grounding so one over-cited suggestion cannot dominate', () => {
      const three = scoreSuggestion({
        illustrationType: 'concept_metaphor',
        fidelityRisk: 'low',
        sourceBlockIds: ['1', '2', '3'],
      })
      const ten = scoreSuggestion({
        illustrationType: 'concept_metaphor',
        fidelityRisk: 'low',
        sourceBlockIds: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      })
      expect(ten).toBe(three)
    })
  })

  describe('planAutoRender', () => {
    it('spends the image budget on the highest-scoring plates', () => {
      const suggestions = [
        sug({ id: 'cover', illustrationType: 'editorial_cover' }),
        sug({
          id: 'mech',
          illustrationType: 'mechanism_explanation',
          sourceBlockIds: ['1', '2', '3'],
        }),
        sug({ id: 'meta', illustrationType: 'concept_metaphor' }),
      ]
      const plan = planAutoRender(suggestions, { maxImages: 2 })
      expect(plan.imageRenderIds).toHaveLength(2)
      // The richly grounded mechanism plate outranks the bare cover.
      expect(plan.imageRenderIds[0]).toBe('mech')
      expect(plan.imageRenderIds).not.toContain('cover')
    })

    it('never auto-renders high-risk or manual-only types', () => {
      const suggestions = [
        sug({
          id: 'risky',
          illustrationType: 'concept_metaphor',
          fidelityRisk: 'high',
        }),
        sug({ id: 'deco', illustrationType: 'decorative_section' }),
        sug({ id: 'data', illustrationType: 'data_figure', diagramSpec: spec }),
      ]
      const plan = planAutoRender(suggestions, { maxImages: 3 })
      expect(plan.imageRenderIds).toEqual([])
      expect(plan.diagramAutoIds).toEqual([]) // data_figure is manual-only
    })

    it('auto-places eligible diagrams that carry a spec, free of the image budget', () => {
      const suggestions = [
        sug({
          id: 'proc',
          illustrationType: 'process_diagram',
          diagramSpec: spec,
        }),
        sug({
          id: 'nospec',
          illustrationType: 'process_diagram',
          diagramSpec: null,
        }),
        sug({ id: 'cover', illustrationType: 'editorial_cover' }),
      ]
      const plan = planAutoRender(suggestions, { maxImages: 0 })
      expect(plan.diagramAutoIds).toEqual(['proc'])
      // A diagram without a spec cannot be auto-placed.
      expect(plan.diagramAutoIds).not.toContain('nospec')
      // maxImages=0 → no plates even though one is eligible.
      expect(plan.imageRenderIds).toEqual([])
    })

    it('penalises repeated types so duplicates do not crowd the budget', () => {
      const suggestions = [
        sug({ id: 'c1', illustrationType: 'editorial_cover' }),
        sug({ id: 'c2', illustrationType: 'editorial_cover' }),
        sug({ id: 'c3', illustrationType: 'editorial_cover' }),
      ]
      const plan = planAutoRender(suggestions, { maxImages: 3 })
      // editorial_cover base score is 2 (importance 1 + grounding 1); the second
      // costs -1 (→1, still in), the third -2 (→0, dropped).
      expect(plan.imageRenderIds).toEqual(['c1', 'c2'])
    })
  })
})
