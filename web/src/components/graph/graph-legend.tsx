/**
 * A small, quiet legend mapping node chip colors to cognitive states and edge
 * styles to their meaning. A native <details> so it can be collapsed to reclaim
 * canvas space; open by default. Floats in the map's top-left HUD column.
 */
export function GraphLegend() {
  return (
    <details className='graph-legend' open>
      <summary className='graph-legend-summary'>Legend</summary>
      <div className='graph-legend-body'>
        <ul className='graph-legend-list'>
          <li>
            <span className='chip chip-cleared'>Retained</span>
            <span>Retrieved · Defended · Internalized</span>
          </li>
          <li>
            <span className='chip chip-contested'>Contested</span>
            <span>Conflicts with something you hold</span>
          </li>
          <li>
            <span className='chip chip-pending'>Dormant</span>
            <span>Faded — decayed past the floor</span>
          </li>
          <li>
            <span className='chip chip-quiet'>Other</span>
            <span>Seen · Parsed · Explained · Linked</span>
          </li>
          <li>
            <span className='chip chip-ai'>Living</span>
            <span>Has an AI persona (scaffold)</span>
          </li>
          <li>
            <span className='chip chip-quiet is-faded'>Archived</span>
            <span>Retired — dimmed, kept for context</span>
          </li>
        </ul>
        <div className='graph-legend-h'>Edges</div>
        <ul className='graph-legend-list'>
          <li>
            <span className='graph-legend-edge is-suggested' />
            <span>Suggested — AI proposal, awaiting validation</span>
          </li>
          <li>
            <span className='graph-legend-edge is-confirmed' />
            <span>Confirmed — an earned connection</span>
          </li>
          <li>
            <span className='graph-legend-edge is-contradiction' />
            <span>Contradiction</span>
          </li>
        </ul>
      </div>
    </details>
  )
}
