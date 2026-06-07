import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from '../empty-state'

/**
 * DET-308: the shared empty state. Two contracts matter — the observation always
 * renders, and the forward-pointing CTA renders as a real link (one step back in
 * the loop) only when a surface supplies one. Origin/secondary surfaces omit it.
 */
describe('EmptyState', () => {
  it('renders the message and hint without a CTA when none is given', () => {
    render(
      <EmptyState message='No tracks yet.' hint='Start one above — name it.' />,
    )
    expect(screen.getByText('No tracks yet.')).toBeInTheDocument()
    expect(screen.getByText('Start one above — name it.')).toBeInTheDocument()
    // No surface-without-a-previous-step should ship a link.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders the CTA as a single link to the previous loop step', () => {
    render(
      <EmptyState
        message='No concepts yet.'
        hint='Concepts are earned, not captured.'
        cta={{ href: '/inbox', label: 'Read your first source' }}
      />,
    )
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/inbox')
    expect(links[0]).toHaveTextContent('Read your first source')
  })

  it('renders extra controls passed as children alongside the CTA', () => {
    render(
      <EmptyState
        message='Nothing is due for review.'
        cta={{ href: '/concepts', label: 'Earn a concept first' }}
      >
        <button type='button'>End session</button>
      </EmptyState>,
    )
    expect(
      screen.getByRole('link', { name: /Earn a concept first/ }),
    ).toHaveAttribute('href', '/concepts')
    expect(
      screen.getByRole('button', { name: 'End session' }),
    ).toBeInTheDocument()
  })
})
