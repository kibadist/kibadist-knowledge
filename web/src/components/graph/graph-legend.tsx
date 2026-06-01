/**
 * A small, quiet legend mapping node chip colors to cognitive states and edge
 * styles to their meaning. Sits in a corner of the canvas so the map stays
 * self-explanatory without a manual.
 */
export function GraphLegend() {
  return (
    <div className='graph-legend'>
      <div className='graph-legend-h'>Legend</div>
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
  )
}
