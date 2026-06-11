import {
  autoEligibleByType,
  isDiagramType,
  renderStrategyFor,
} from './illustration-taxonomy'

describe('illustration-taxonomy', () => {
  describe('renderStrategyFor', () => {
    it('routes generative plate types to image', () => {
      expect(renderStrategyFor('editorial_cover')).toBe('image')
      expect(renderStrategyFor('decorative_section')).toBe('image')
      expect(renderStrategyFor('concept_metaphor')).toBe('image')
      expect(renderStrategyFor('mechanism_explanation')).toBe('image')
    })

    it('routes structural/precise types to diagram', () => {
      expect(renderStrategyFor('source_based_diagram')).toBe('diagram')
      expect(renderStrategyFor('process_diagram')).toBe('diagram')
      expect(renderStrategyFor('comparison_visual')).toBe('diagram')
      expect(renderStrategyFor('data_figure')).toBe('diagram')
    })

    it('isDiagramType agrees with the strategy', () => {
      expect(isDiagramType('process_diagram')).toBe(true)
      expect(isDiagramType('editorial_cover')).toBe(false)
    })
  })

  describe('autoEligibleByType', () => {
    it('excludes decorative and data figures from the automatic pass', () => {
      expect(autoEligibleByType('decorative_section')).toBe(false)
      expect(autoEligibleByType('data_figure')).toBe(false)
    })

    it('admits comprehension-bearing types', () => {
      expect(autoEligibleByType('editorial_cover')).toBe(true)
      expect(autoEligibleByType('concept_metaphor')).toBe(true)
      expect(autoEligibleByType('process_diagram')).toBe(true)
      expect(autoEligibleByType('source_based_diagram')).toBe(true)
    })
  })
})
