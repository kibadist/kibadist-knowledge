'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import './landing.css'

export default function HomePage() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    // Gentle scroll reveal — add the class at runtime so content stays visible
    // if JS never runs, then fade sections in as they enter the viewport.
    const revealEls = Array.from(
      root.querySelectorAll<HTMLElement>('.section, .submission, .method-wrap'),
    )
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.classList.add('in')
        }
      },
      { threshold: 0.08 },
    )
    for (const el of revealEls) {
      el.classList.add('reveal')
      observer.observe(el)
    }

    // Smooth in-page scrolling for section anchors.
    const anchors = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
    )
    const onAnchorClick = (event: Event) => {
      const anchor = event.currentTarget as HTMLAnchorElement
      const href = anchor.getAttribute('href')
      if (!href || href.length < 2) return
      const target = root.querySelector(href)
      if (target) {
        event.preventDefault()
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    for (const anchor of anchors) {
      anchor.addEventListener('click', onAnchorClick)
    }

    return () => {
      observer.disconnect()
      for (const anchor of anchors) {
        anchor.removeEventListener('click', onAnchorClick)
      }
    }
  }, [])

  return (
    <div className='landing' ref={rootRef}>
      <link rel='preconnect' href='https://fonts.googleapis.com' />
      <link
        rel='preconnect'
        href='https://fonts.gstatic.com'
        crossOrigin='anonymous'
      />
      <link
        rel='stylesheet'
        precedence='default'
        href='https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&family=JetBrains+Mono:wght@300;400;500;700&display=swap'
      />

      {/* TOP STRIP */}
      <div className='strip'>
        <div className='strip-inner'>
          <span>
            <span className='dot green' /> Submissions open · Cohort III
          </span>
          <span>ISSN 2026—01 · Volume I</span>
          <span>Local-first · Self-hosted · Sovereign</span>
        </div>
      </div>

      {/* MASTHEAD */}
      <header className='masthead'>
        <h1 className='title'>
          Kibadist <em>Knowledge</em>
        </h1>
        <div className='subtitle'>
          A workspace for methodical cognition — built on Logseq, governed by
          you.
        </div>
        <div className='masthead-meta'>
          <span>Thursday · 28 May, 2026</span>
          <span>Field Notes № 014</span>
          <span>Read time · 3 min</span>
        </div>
      </header>

      {/* NAV */}
      <nav className='primary'>
        <div className='nav-inner'>
          <a href='#gate'>The Gate</a>
          <a href='#sovereignty'>Sovereignty</a>
          <a href='#apparatus'>Apparatus</a>
          <a href='#methodology'>Methodology</a>
          <a href='#foundations'>Foundations</a>
          <a href='#submission'>Submission</a>
        </div>
      </nav>

      {/* HERO / ABSTRACT */}
      <section className='hero'>
        <div className='wrap'>
          <div className='hero-grid'>
            <div>
              <div className='section-label'>Editorial · Issue 01</div>
              <h1>
                The machine has solved the problem of finding information.{' '}
                <em>It has not solved the problem of understanding it.</em>
              </h1>

              <p className='hero-lede'>
                Kibadist is a learning operating system that refuses to remember
                anything until you can prove that you do. No more AI dumping
                grounds. No more illusions of comprehension.
              </p>

              <div className='cta-row'>
                <Link href='/register' className='btn-primary'>
                  Request Early Access
                </Link>
                <a href='#methodology' className='btn-ghost'>
                  Read the Manifesto
                </a>
              </div>

              <div className='citations'>
                <div className='cite'>
                  <div className='num'>
                    07<sup>×</sup>
                  </div>
                  <div className='desc'>
                    Higher 30-day retention vs. passive note-taking
                  </div>
                </div>
                <div className='cite'>
                  <div className='num'>
                    100<sup>%</sup>
                  </div>
                  <div className='desc'>
                    Local-first storage. Your graph, your hardware
                  </div>
                </div>
                <div className='cite'>
                  <div className='num'>14</div>
                  <div className='desc'>
                    Cognitive principles modelled in the engine
                  </div>
                </div>
                <div className='cite'>
                  <div className='num'>∞</div>
                  <div className='desc'>
                    Knowledge graph, append-only, yours forever
                  </div>
                </div>
              </div>
            </div>

            <aside className='abstract'>
              <div className='abstract-head'>
                <span className='lbl'>Abstract · Document 01</span>
                <span className='fig'>i</span>
              </div>
              <p className='dropcap'>
                The contemporary knowledge worker drowns in capture: clipped
                articles, half-watched lectures, AI summaries that promise
                mastery and deliver familiarity. Kibadist proposes an inversion
                — a workspace where every artefact must pass through a
                Proof-of-Learning gate before entering permanent memory.
              </p>
              <p>
                In place of frictionless ingestion, we design{' '}
                <em>desirable difficulty.</em> In place of summaries, we require
                explanations in the user&apos;s own voice. Information is
                plentiful; understanding is the bottleneck.
              </p>
              <div className='keywords'>
                <span>spaced repetition</span>
                <span>active recall</span>
                <span>graph cognition</span>
                <span>LLM-assisted</span>
                <span>local-first</span>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* §I · THE GATE */}
      <section className='section' id='gate'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § I<small>The Proof-of-Learning Gate</small>
            </div>
            <div>
              <div className='section-label'>Mechanism</div>
              <h2 className='sec-title'>
                Nothing is remembered <em>until it is earned.</em>
              </h2>
              <p className='sec-lede'>
                Between the act of capture and the act of preservation, we
                install a single, stubborn checkpoint. Three small frictions
                that separate noise from knowledge.
              </p>
            </div>
          </div>

          <div className='gate-grid'>
            <div className='gate-svg-wrap'>
              <svg
                viewBox='0 0 500 460'
                xmlns='http://www.w3.org/2000/svg'
                style={{ width: '100%', height: 'auto', display: 'block' }}
                role='img'
                aria-label='Schematic of the Proof-of-Learning gate'
              >
                <defs>
                  <pattern
                    id='grid'
                    width='20'
                    height='20'
                    patternUnits='userSpaceOnUse'
                  >
                    <path
                      d='M 20 0 L 0 0 0 20'
                      fill='none'
                      stroke='#c8bea8'
                      strokeWidth='0.4'
                      opacity='0.5'
                    />
                  </pattern>
                  <filter id='rough'>
                    <feTurbulence baseFrequency='0.02' numOctaves='2' />
                    <feDisplacementMap in='SourceGraphic' scale='1.2' />
                  </filter>
                </defs>
                <rect width='500' height='460' fill='url(#grid)' />

                {/* INCOMING */}
                <g>
                  <circle
                    cx='80'
                    cy='80'
                    r='28'
                    fill='#f1ebde'
                    stroke='#1a1714'
                    strokeWidth='1.5'
                    filter='url(#rough)'
                  />
                  <text
                    x='80'
                    y='86'
                    textAnchor='middle'
                    fontFamily='JetBrains Mono'
                    fontSize='20'
                    fill='#1a1714'
                    fontWeight='600'
                  >
                    α
                  </text>
                  <text
                    x='80'
                    y='138'
                    textAnchor='middle'
                    fontFamily='JetBrains Mono'
                    fontSize='9'
                    fill='#6b6157'
                    letterSpacing='1.5'
                  >
                    RAW · INPUT
                  </text>
                </g>

                {/* arrow down */}
                <line
                  x1='80'
                  y1='160'
                  x2='80'
                  y2='210'
                  stroke='#1a1714'
                  strokeWidth='1'
                  strokeDasharray='2,4'
                />
                <polygon points='76,205 80,215 84,205' fill='#1a1714' />

                {/* THE GATE */}
                <g>
                  <rect
                    x='40'
                    y='220'
                    width='420'
                    height='140'
                    fill='#f1ebde'
                    stroke='#8a2a1f'
                    strokeWidth='1.5'
                  />
                  <rect
                    x='44'
                    y='224'
                    width='412'
                    height='132'
                    fill='none'
                    stroke='#8a2a1f'
                    strokeWidth='0.4'
                  />

                  <text
                    x='250'
                    y='248'
                    textAnchor='middle'
                    fontFamily='JetBrains Mono'
                    fontSize='10'
                    fill='#8a2a1f'
                    letterSpacing='2.5'
                    fontWeight='600'
                  >
                    THE PROOF-OF-LEARNING GATE
                  </text>

                  <g transform='translate(85,290)'>
                    <circle
                      r='16'
                      fill='#f1ebde'
                      stroke='#1a1714'
                      strokeWidth='1'
                    />
                    <text
                      y='5'
                      textAnchor='middle'
                      fontFamily='Fraunces'
                      fontStyle='italic'
                      fontSize='16'
                      fill='#1a1714'
                    >
                      1
                    </text>
                    <text
                      y='42'
                      textAnchor='middle'
                      fontFamily='JetBrains Mono'
                      fontSize='8'
                      fill='#3a332c'
                    >
                      EXPLAIN
                    </text>
                  </g>
                  <g transform='translate(250,290)'>
                    <circle
                      r='16'
                      fill='#f1ebde'
                      stroke='#1a1714'
                      strokeWidth='1'
                    />
                    <text
                      y='5'
                      textAnchor='middle'
                      fontFamily='Fraunces'
                      fontStyle='italic'
                      fontSize='16'
                      fill='#1a1714'
                    >
                      2
                    </text>
                    <text
                      y='42'
                      textAnchor='middle'
                      fontFamily='JetBrains Mono'
                      fontSize='8'
                      fill='#3a332c'
                    >
                      CONNECT
                    </text>
                  </g>
                  <g transform='translate(415,290)'>
                    <circle
                      r='16'
                      fill='#f1ebde'
                      stroke='#1a1714'
                      strokeWidth='1'
                    />
                    <text
                      y='5'
                      textAnchor='middle'
                      fontFamily='Fraunces'
                      fontStyle='italic'
                      fontSize='16'
                      fill='#1a1714'
                    >
                      3
                    </text>
                    <text
                      y='42'
                      textAnchor='middle'
                      fontFamily='JetBrains Mono'
                      fontSize='8'
                      fill='#3a332c'
                    >
                      RETRIEVE
                    </text>
                  </g>

                  <line
                    x1='101'
                    y1='290'
                    x2='234'
                    y2='290'
                    stroke='#8a2a1f'
                    strokeWidth='0.8'
                  />
                  <line
                    x1='266'
                    y1='290'
                    x2='399'
                    y2='290'
                    stroke='#8a2a1f'
                    strokeWidth='0.8'
                  />
                </g>

                {/* arrow down */}
                <line
                  x1='250'
                  y1='370'
                  x2='250'
                  y2='400'
                  stroke='#1a1714'
                  strokeWidth='1'
                  strokeDasharray='2,4'
                />
                <polygon points='246,395 250,405 254,395' fill='#1a1714' />

                {/* GRAPH NODE INTEGRATED */}
                <g transform='translate(250,425)'>
                  <circle cx='-90' cy='0' r='12' fill='#1a1714' />
                  <circle cx='-50' cy='-18' r='9' fill='#1a1714' />
                  <circle cx='50' cy='-15' r='10' fill='#1a1714' />
                  <circle cx='95' cy='5' r='8' fill='#1a1714' />
                  <circle
                    cx='0'
                    cy='0'
                    r='14'
                    fill='#8a2a1f'
                    stroke='#1a1714'
                    strokeWidth='1.5'
                  />
                  <text
                    y='5'
                    textAnchor='middle'
                    fontFamily='Fraunces'
                    fontSize='14'
                    fill='#f1ebde'
                    fontWeight='700'
                  >
                    α
                  </text>

                  <line
                    x1='0'
                    y1='0'
                    x2='-90'
                    y2='0'
                    stroke='#1a1714'
                    strokeWidth='0.8'
                  />
                  <line
                    x1='0'
                    y1='0'
                    x2='-50'
                    y2='-18'
                    stroke='#1a1714'
                    strokeWidth='0.8'
                  />
                  <line
                    x1='0'
                    y1='0'
                    x2='50'
                    y2='-15'
                    stroke='#1a1714'
                    strokeWidth='0.8'
                  />
                  <line
                    x1='0'
                    y1='0'
                    x2='95'
                    y2='5'
                    stroke='#1a1714'
                    strokeWidth='0.8'
                  />
                </g>
                <text
                  x='250'
                  y='455'
                  textAnchor='middle'
                  fontFamily='JetBrains Mono'
                  fontSize='9'
                  fill='#6b6157'
                  letterSpacing='1.5'
                >
                  VALIDATED · INTEGRATED INTO GRAPH
                </text>

                <text
                  x='490'
                  y='80'
                  textAnchor='end'
                  fontFamily='Fraunces'
                  fontStyle='italic'
                  fontSize='11'
                  fill='#8a2a1f'
                >
                  paper, video,
                </text>
                <text
                  x='490'
                  y='94'
                  textAnchor='end'
                  fontFamily='Fraunces'
                  fontStyle='italic'
                  fontSize='11'
                  fill='#8a2a1f'
                >
                  podcast, PDF
                </text>
                <line
                  x1='408'
                  y1='80'
                  x2='115'
                  y2='80'
                  stroke='#8a2a1f'
                  strokeWidth='0.5'
                  strokeDasharray='1,3'
                />

                <text
                  x='10'
                  y='225'
                  fontFamily='Fraunces'
                  fontStyle='italic'
                  fontSize='11'
                  fill='#8a2a1f'
                >
                  filter
                </text>
              </svg>
            </div>

            <div className='gate-steps'>
              <div className='step'>
                <span className='step-num'>i.</span>
                <div>
                  <h4>Capture without commitment.</h4>
                  <p>
                    Drop in papers, lectures, podcasts, threads — anything
                    you&apos;d typically save and forget. AI agents parse them
                    into structured claims, concepts, questions, and
                    relationships. Nothing is permanent yet.
                  </p>
                </div>
              </div>
              <div className='step'>
                <span className='step-num'>ii.</span>
                <div>
                  <h4>Submit to the gate.</h4>
                  <p>
                    Before a fact joins your graph, explain it in your own
                    words. Connect it to an existing note. Answer three
                    retrieval prompts the system generates from the source
                    itself.
                  </p>
                </div>
              </div>
              <div className='step'>
                <span className='step-num'>iii.</span>
                <div>
                  <h4>Earn the entry.</h4>
                  <p>
                    Pass, and the concept is integrated — annotated with its
                    provenance, lineage, and review schedule. Fail, and the
                    source returns to the queue. The friction is the feature.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* §II · SOVEREIGNTY */}
      <section className='section' id='sovereignty'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § II<small>Data Sovereignty</small>
            </div>
            <div>
              <div className='section-label'>Privacy as Architecture</div>
              <h2 className='sec-title'>
                For work that <em>cannot leave the lab.</em>
              </h2>
              <p className='sec-lede'>
                Researchers, clinicians, founders, and scientific teams should
                not have to choose between AI assistance and confidentiality.
                Kibadist treats local execution as a first-class citizen — not a
                feature, but a posture.
              </p>
            </div>
          </div>

          <div className='pullquote'>
            <p>The cloud is convenient. Your unpublished work is not for it.</p>
            <div className='attr'>— from the design rationale</div>
          </div>

          <div className='sov-grid'>
            <ol className='policy-list'>
              <li>
                <strong>Local LLMs by default.</strong> Run Ollama, LM Studio,
                llama.cpp, or your own GPU stack. The system never assumes an
                internet connection.
              </li>
              <li>
                <strong>Self-hosted parsing &amp; retrieval.</strong>{' '}
                Summarisation, embedding, and retrieval can be served entirely
                by open-weights models you control.
              </li>
              <li>
                <strong>Excerpt-level egress.</strong> When external APIs are
                useful, only user-approved excerpts or sanitised metadata leave
                your machine.
              </li>
              <li>
                <strong>Encrypted graph at rest.</strong> Notes, embeddings,
                vector indices, and source files remain in an environment you
                administer.
              </li>
              <li>
                <strong>Per-workspace policy.</strong> Mark a project
                local-only, private-cloud, or external-allowed — and the
                platform enforces it accordingly.
              </li>
            </ol>

            <div className='policy-card'>
              <h3>Workspace · Lab Notebooks</h3>
              <div className='stamp'>LOCAL ONLY · CLEARED</div>

              <div className='policy-row'>
                <span className='k'>Input</span>
                <span className='v'>
                  Unpublished papers, raw datasets, clinical notes
                </span>
              </div>
              <div className='policy-row'>
                <span className='k'>Processing</span>
                <span className='v'>
                  Self-hosted Llama-3 70B · local embeddings
                </span>
              </div>
              <div className='policy-row'>
                <span className='k'>Storage</span>
                <span className='v'>
                  Encrypted local graph · private vector DB
                </span>
              </div>
              <div className='policy-row'>
                <span className='k'>Egress</span>
                <span className='v'>Metadata only · user-confirmed</span>
              </div>
              <div className='policy-row blocked'>
                <span className='k'>Blocked</span>
                <span className='v'>
                  Raw data sent to public model providers
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* §III · APPARATUS / FEATURES */}
      <section className='section' id='apparatus'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § III<small>The Apparatus</small>
            </div>
            <div>
              <div className='section-label'>Components &amp; Instruments</div>
              <h2 className='sec-title'>
                A toolkit for <em>thinking, not collecting.</em>
              </h2>
              <p className='sec-lede'>
                Most AI note apps optimise for speed of capture. Kibadist
                optimises for what remains six months later — six years later —
                in your head, and in the graph you can hand to a collaborator.
              </p>
            </div>
          </div>

          <div className='feature-grid'>
            <div className='feat'>
              <div className='feat-num'>i. Ingestion</div>
              <svg
                className='feat-icon'
                width='44'
                height='44'
                viewBox='0 0 44 44'
                fill='none'
                aria-hidden='true'
              >
                <rect
                  x='6'
                  y='6'
                  width='32'
                  height='32'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <line
                  x1='14'
                  y1='16'
                  x2='30'
                  y2='16'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <line
                  x1='14'
                  y1='22'
                  x2='30'
                  y2='22'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <line
                  x1='14'
                  y1='28'
                  x2='24'
                  y2='28'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <circle cx='33' cy='11' r='3' fill='#8a2a1f' />
              </svg>
              <h3>AI Research Agents</h3>
              <p>
                Parse papers, videos, articles, PDFs, podcasts, and datasets
                into structured learning objects — claims, concepts, open
                questions.
              </p>
              <div className='feat-mono'>→ multi-modal ingest</div>
            </div>

            <div className='feat'>
              <div className='feat-num'>ii. Validation</div>
              <svg
                className='feat-icon'
                width='44'
                height='44'
                viewBox='0 0 44 44'
                fill='none'
                aria-hidden='true'
              >
                <circle
                  cx='22'
                  cy='22'
                  r='14'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <path
                  d='M 22 12 L 22 22 L 30 26'
                  stroke='currentColor'
                  strokeWidth='1.4'
                  strokeLinecap='round'
                />
                <circle cx='22' cy='22' r='2' fill='#8a2a1f' />
              </svg>
              <h3>Proof-of-Learning Gate</h3>
              <p>
                Nothing enters permanent memory until you explain it in your own
                language, recall it cold, and connect it to what you already
                know.
              </p>
              <div className='feat-mono'>→ active recall enforced</div>
            </div>

            <div className='feat'>
              <div className='feat-num'>iii. Substrate</div>
              <svg
                className='feat-icon'
                width='44'
                height='44'
                viewBox='0 0 44 44'
                fill='none'
                aria-hidden='true'
              >
                <circle
                  cx='10'
                  cy='10'
                  r='4'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <circle
                  cx='34'
                  cy='10'
                  r='4'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <circle
                  cx='22'
                  cy='22'
                  r='4'
                  fill='#8a2a1f'
                  stroke='#8a2a1f'
                  strokeWidth='1.4'
                />
                <circle
                  cx='10'
                  cy='34'
                  r='4'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <circle
                  cx='34'
                  cy='34'
                  r='4'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <line
                  x1='13'
                  y1='12'
                  x2='19'
                  y2='20'
                  stroke='currentColor'
                  strokeWidth='1'
                />
                <line
                  x1='31'
                  y1='12'
                  x2='25'
                  y2='20'
                  stroke='currentColor'
                  strokeWidth='1'
                />
                <line
                  x1='13'
                  y1='32'
                  x2='19'
                  y2='24'
                  stroke='currentColor'
                  strokeWidth='1'
                />
                <line
                  x1='31'
                  y1='32'
                  x2='25'
                  y2='24'
                  stroke='currentColor'
                  strokeWidth='1'
                />
              </svg>
              <h3>Graph Knowledge Engine</h3>
              <p>
                Built atop Logseq: local-first, plaintext, version-controllable.
                The substrate is yours. The format outlives the company.
              </p>
              <div className='feat-mono'>→ logseq-compatible</div>
            </div>

            <div className='feat'>
              <div className='feat-num'>iv. Practice</div>
              <svg
                className='feat-icon'
                width='44'
                height='44'
                viewBox='0 0 44 44'
                fill='none'
                aria-hidden='true'
              >
                <path
                  d='M 6 32 Q 16 8, 22 22 T 38 14'
                  stroke='currentColor'
                  strokeWidth='1.4'
                  fill='none'
                />
                <circle cx='6' cy='32' r='2' fill='currentColor' />
                <circle cx='22' cy='22' r='2' fill='currentColor' />
                <circle cx='38' cy='14' r='2' fill='#8a2a1f' />
              </svg>
              <h3>Scientific Learning Loops</h3>
              <p>
                Retrieval practice, spaced repetition, interleaving, and
                elaboration — orchestrated automatically as you build your
                graph.
              </p>
              <div className='feat-mono'>→ evidence-based scheduling</div>
            </div>

            <div className='feat'>
              <div className='feat-num'>v. Collaboration</div>
              <svg
                className='feat-icon'
                width='44'
                height='44'
                viewBox='0 0 44 44'
                fill='none'
                aria-hidden='true'
              >
                <circle
                  cx='14'
                  cy='16'
                  r='6'
                  stroke='currentColor'
                  strokeWidth='1.4'
                />
                <circle
                  cx='30'
                  cy='16'
                  r='6'
                  stroke='currentColor'
                  strokeWidth='1.4'
                  fill='#8a2a1f'
                  fillOpacity='0.15'
                />
                <path
                  d='M 6 36 Q 14 26, 22 32 Q 30 26, 38 36'
                  stroke='currentColor'
                  strokeWidth='1.4'
                  fill='none'
                />
              </svg>
              <h3>Shared Research Spaces</h3>
              <p>
                Build common graphs for labs, teams, and study circles — with
                policy controls that respect both authorship and access.
              </p>
              <div className='feat-mono'>→ end-to-end-encrypted sync</div>
            </div>

            <div className='feat'>
              <div className='feat-num'>vi. Maintenance</div>
              <svg
                className='feat-icon'
                width='44'
                height='44'
                viewBox='0 0 44 44'
                fill='none'
                aria-hidden='true'
              >
                <path
                  d='M 8 12 L 36 12 L 30 32 L 14 32 Z'
                  stroke='currentColor'
                  strokeWidth='1.4'
                  fill='none'
                />
                <line
                  x1='18'
                  y1='22'
                  x2='26'
                  y2='22'
                  stroke='#8a2a1f'
                  strokeWidth='2'
                />
                <circle cx='22' cy='22' r='1.5' fill='#8a2a1f' />
              </svg>
              <h3>Memory Decay Detection</h3>
              <p>
                The system watches for fading mastery — weak retrieval, drifting
                connections — and schedules adaptive review automatically.
              </p>
              <div className='feat-mono'>→ continuous reinforcement</div>
            </div>
          </div>
        </div>
      </section>

      {/* §IV · METHODOLOGY */}
      <div className='method-wrap' id='methodology'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § IV<small>Methodology</small>
            </div>
            <div>
              <div className='section-label'>The Procedure</div>
              <h2 className='sec-title'>
                Knowledge, in <em>five movements.</em>
              </h2>
              <p className='sec-lede'>
                The loop is short. The discipline is in repeating it. Each
                capture earns its place in the graph by passing the same five
                stages.
              </p>
            </div>
          </div>

          <div className='procedure'>
            <div className='proc'>
              <div className='proc-step'>Step 01</div>
              <h4>Capture</h4>
              <p>
                Pull in research, papers, lectures, or conversations — from
                anywhere.
              </p>
            </div>
            <div className='proc'>
              <div className='proc-step'>Step 02</div>
              <h4>Parse</h4>
              <p>
                Agents extract claims, concepts, questions, and relations into a
                draft.
              </p>
            </div>
            <div className='proc'>
              <div className='proc-step'>Step 03</div>
              <h4>Challenge</h4>
              <p>
                The gate demands active recall and explanation before saving.
              </p>
            </div>
            <div className='proc'>
              <div className='proc-step'>Step 04</div>
              <h4>Connect</h4>
              <p>
                You weave the concept into existing nodes; the graph thickens.
              </p>
            </div>
            <div className='proc'>
              <div className='proc-step'>Step 05</div>
              <h4>Remember</h4>
              <p>
                Spaced reviews are scheduled. Memory is reinforced, on cadence.
              </p>
            </div>
          </div>

          <div className='method-trace'>
            <span>capture →</span> parse <span>→</span> challenge <span>→</span>{' '}
            connect <span>→</span> remember <span>→</span> capture{' '}
            <span>→</span> <em>(repeat, until fluency)</em>
          </div>
        </div>
      </div>

      {/* §V · EMPIRICAL FOUNDATIONS */}
      <section className='section' id='foundations'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § V<small>Empirical Foundations</small>
            </div>
            <div>
              <div className='section-label'>From the Literature</div>
              <h2 className='sec-title'>
                Optimised for <em>remembering.</em>
              </h2>
              <p className='sec-lede'>
                The platform&apos;s loops are not invented. They are an
                engineering implementation of effects established across four
                decades of cognitive psychology — assembled, for the first time,
                in a single workspace.
              </p>
            </div>
          </div>

          <div className='principles'>
            <div className='principle'>
              <div className='p-num'>i</div>
              <h4>Active Recall</h4>
              <p>
                Retrieval strengthens memory more reliably than re-exposure. The
                gate operationalises this at the moment of saving.
              </p>
              <div className='ref'>cf. Roediger &amp; Karpicke, 2006</div>
            </div>
            <div className='principle'>
              <div className='p-num'>ii</div>
              <h4>Spaced Repetition</h4>
              <p>
                Distributed practice yields durable retention. Intervals are
                tuned per-concept by the engine itself.
              </p>
              <div className='ref'>cf. Cepeda et al., 2008</div>
            </div>
            <div className='principle'>
              <div className='p-num'>iii</div>
              <h4>Generation Effect</h4>
              <p>
                Producing an answer in your own words outperforms reading the
                same answer.
              </p>
              <div className='ref'>cf. Slamecka &amp; Graf, 1978</div>
            </div>
            <div className='principle'>
              <div className='p-num'>iv</div>
              <h4>Knowledge Linking</h4>
              <p>
                Concepts integrated into prior schemas are retrieved more
                reliably. Graph structure makes the schema legible.
              </p>
              <div className='ref'>cf. Bransford et al., 1979</div>
            </div>
          </div>

          <div className='footnotes'>
            <p>
              <sup>†</sup> Bjork &amp; Bjork (1992) call this &ldquo;desirable
              difficulty&rdquo; — the counter-intuitive result that effortful
              retrieval predicts long-term retention better than easy review.
            </p>
            <p>
              <sup>‡</sup> Interleaving topics within a session produces lower
              in-session performance but markedly better transfer; Kibadist
              schedules accordingly.
            </p>
            <p>
              <sup>§</sup> The system&apos;s review intervals are derived from a
              half-life model fit to per-concept retrieval data, not the fixed
              SM-2 ratios of legacy SRS apps.
            </p>
            <p>
              <sup>¶</sup> Where the gate cannot be passed, the source is
              annotated and re-surfaced; failure becomes a signal, not a
              punishment.
            </p>
          </div>
        </div>
      </section>

      {/* §VI · SUBMISSION */}
      <section className='submission' id='submission'>
        <div className='wrap'>
          <div className='stamp-frame'>
            <span className='stamp-corner tl' />
            <span className='stamp-corner tr' />
            <span className='stamp-corner bl' />
            <span className='stamp-corner br' />

            <div className='section-label' style={{ justifyContent: 'center' }}>
              Early Access · Cohort III
            </div>
            <h2>
              Build a second brain
              <br />
              <em>that actually remembers.</em>
            </h2>
            <p>
              A learning operating system for researchers, engineers,
              scientists, founders, and the lifelong curious. Currently in
              private preview.
            </p>

            <div className='cta-row'>
              <Link href='/register' className='btn-primary'>
                Submit for Access
              </Link>
              <Link href='/login' className='btn-ghost'>
                Sign In
              </Link>
            </div>

            <div className='meta'>
              No spam. One letter per fortnight, at most.
            </div>
          </div>
        </div>
      </section>

      {/* COLOPHON */}
      <footer className='colophon'>
        <div className='wrap'>
          <div className='colophon-grid'>
            <div className='imprint'>
              <strong>Kibadist Knowledge</strong>
              Set in <em>Fraunces</em> and <em>Newsreader</em>. Printed
              digitally on a paper-toned canvas, with deepest respect for the
              practice of slow reading. Built on Logseq.
            </div>

            <div>
              <h5>Workspace</h5>
              <ul>
                <li>
                  <a href='#gate'>The Gate</a>
                </li>
                <li>
                  <a href='#sovereignty'>Sovereignty</a>
                </li>
                <li>
                  <a href='#apparatus'>Apparatus</a>
                </li>
                <li>
                  <a href='#methodology'>Methodology</a>
                </li>
              </ul>
            </div>

            <div>
              <h5>Resources</h5>
              <ul>
                <li>
                  <a href='#methodology'>Manifesto</a>
                </li>
                <li>
                  <a href='#apparatus'>Documentation</a>
                </li>
                <li>
                  <a href='#foundations'>Reading list</a>
                </li>
                <li>
                  <a href='#gate'>Field notes</a>
                </li>
              </ul>
            </div>

            <div>
              <h5>Contact</h5>
              <ul>
                <li>
                  <a href='mailto:hello@kibadist.co'>hello@kibadist.co</a>
                </li>
                <li>
                  <Link href='/register'>Request access</Link>
                </li>
                <li>
                  <Link href='/login'>Sign in</Link>
                </li>
              </ul>
            </div>
          </div>

          <div className='footer-rule'>
            <span>© MMXXVI · Kibadist Press</span>
            <span>Issue 01 · Set in good faith</span>
            <span>Local-first · Logseq-based · Sovereign</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
