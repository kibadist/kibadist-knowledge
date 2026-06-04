'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { ApiError, api, type WaitlistSource } from '@/lib/api'

import './landing.css'

// Inline waitlist form (DET-270). Client-side; submits to the public
// POST /api/waitlist contract. On success it swaps itself for a confirmation,
// so the CTA reads as resolved. `source` distinguishes hero vs footer signups.
type WaitlistStatus = 'idle' | 'pending' | 'done' | 'error'

function WaitlistForm({
  source,
  variant = 'light',
}: {
  source: WaitlistSource
  variant?: 'light' | 'dark'
}) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<WaitlistStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (status === 'pending') return
    setStatus('pending')
    setError(null)
    try {
      await api.joinWaitlist({ email, source })
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setError(
        err instanceof ApiError
          ? err.message
          : 'Something went wrong. Please try again.',
      )
    }
  }

  if (status === 'done') {
    return (
      <div
        className={`waitlist-done${variant === 'dark' ? ' on-dark' : ''}`}
        role='status'
      >
        <strong>You&apos;re on the list.</strong>
        <span>
          We&apos;ll reach out when your seat opens. No spam, no summaries —
          just the work.
        </span>
      </div>
    )
  }

  return (
    <form
      className={`waitlist${variant === 'dark' ? ' on-dark' : ''}`}
      onSubmit={onSubmit}
      noValidate
    >
      <div className='waitlist-row'>
        <input
          type='email'
          name='email'
          required
          autoComplete='email'
          placeholder='you@example.com'
          aria-label='Email address'
          value={email}
          disabled={status === 'pending'}
          onChange={(e) => {
            setEmail(e.target.value)
            if (status === 'error') setStatus('idle')
          }}
        />
        <button
          type='submit'
          className='btn-primary'
          disabled={status === 'pending'}
        >
          {status === 'pending' ? 'Joining…' : 'Join the waitlist'}
        </button>
      </div>
      {status === 'error' && error ? (
        <p className='waitlist-error' role='alert'>
          {error}
        </p>
      ) : null}
    </form>
  )
}

export default function HomePage() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    // Gentle scroll reveal — add the class at runtime so content stays visible
    // if JS never runs, then fade sections in as they enter the viewport.
    const revealEls = Array.from(
      root.querySelectorAll<HTMLElement>('.section, .cta-section, .demo-wrap'),
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
            <span className='dot green' /> Waitlist open · Early access
          </span>
          <span>For software learners</span>
          <span>Don&apos;t just save. Understand.</span>
        </div>
      </div>

      {/* MASTHEAD */}
      <header className='masthead'>
        <h1 className='title'>
          Kibadist <em>Knowledge</em>
        </h1>
        <div className='subtitle'>
          The proof-of-learning workspace for people who learn with AI.
        </div>
        <div className='masthead-meta'>
          <span>Concept maps · Living Concepts</span>
          <span>Socratic validation</span>
          <span>Retrieval practice</span>
        </div>
      </header>

      {/* NAV */}
      <nav className='primary'>
        <div className='nav-inner'>
          <a href='#problem'>The Problem</a>
          <a href='#how-it-works'>How It Works</a>
          <a href='#living-concepts'>Living Concepts</a>
          <a href='#proof'>Proof of Learning</a>
          <a href='#benefits'>Benefits</a>
          <a href='#join'>Join</a>
        </div>
      </nav>

      {/* HERO */}
      <section className='hero'>
        <div className='wrap'>
          <div className='hero-grid'>
            <div>
              <div className='section-label'>
                Proof of Learning · Early Access
              </div>
              <h1>
                Don&apos;t just save knowledge.{' '}
                <em>Prove you understand it.</em>
              </h1>

              <p className='hero-lede'>
                Kibadist turns articles, tutorials, papers, and notes into
                concept maps, Socratic questions, Living Concepts, and retrieval
                sessions — so AI helps you build real understanding instead of
                passive summaries.
              </p>

              <div className='hero-cta'>
                <WaitlistForm source='landing-hero' />
                <a href='#how-it-works' className='btn-ghost'>
                  See how it works
                </a>
              </div>

              <div className='hero-aud'>
                Built for self-taught engineers, CS students, bootcampers, and
                career switchers.
              </div>
            </div>

            <aside className='abstract'>
              <div className='abstract-head'>
                <span className='lbl'>Not another notes app</span>
                <span className='fig'>i</span>
              </div>
              <p className='dropcap'>
                Most tools optimise for capture — clip it, summarise it, file it
                away. Kibadist optimises for what stays in your head. Every
                concept must be explained in your own words before it counts as
                learned.
              </p>
              <p>
                It is not a clipboard, not an AI summariser, and not a deck of
                flashcards. It is a workspace that makes you do the thinking AI
                would otherwise do for you.
              </p>
              <div className='keywords'>
                <span>concept maps</span>
                <span>socratic prompts</span>
                <span>living concepts</span>
                <span>retrieval practice</span>
                <span>understanding</span>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* §I · THE PROBLEM */}
      <section className='section' id='problem'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § I<small>The False-Learning Problem</small>
            </div>
            <div>
              <div className='section-label'>
                Why saving isn&apos;t learning
              </div>
              <h2 className='sec-title'>
                You save everything. You remember <em>almost none of it.</em>
              </h2>
              <p className='sec-lede'>
                The feeling of productivity is not the same as understanding. AI
                makes the gap worse: it hands you fluent summaries that feel
                like mastery and leave nothing behind.
              </p>
            </div>
          </div>

          <div className='problem-grid'>
            <div className='problem-card'>
              <div className='p-mono'>01 · The save-and-forget loop</div>
              <h4>Notes you never reopen.</h4>
              <p>
                You highlight, clip, and bookmark — then never look again. The
                archive grows; your understanding doesn&apos;t. Saving feels
                like progress, but it&apos;s just hoarding.
              </p>
            </div>
            <div className='problem-card'>
              <div className='p-mono'>02 · The summary illusion</div>
              <h4>AI summaries feel productive.</h4>
              <p>
                A clean summary reads like comprehension. But you didn&apos;t
                produce it — the model did. You walk away with familiarity, not
                the ability to explain or apply the idea.
              </p>
            </div>
            <div className='problem-card'>
              <div className='p-mono'>03 · Tutorial hell</div>
              <h4>You follow along, then go blank.</h4>
              <p>
                You finish the tutorial, the code runs, it all made sense in the
                moment. A week later you can&apos;t rebuild it or explain why it
                worked. Following is not the same as knowing.
              </p>
            </div>
          </div>

          <div className='differentiator'>
            <div className='diff-row'>
              <span className='k'>Not a notes app</span>
              <span className='v'>
                Notes apps reward capture. Kibadist refuses to call anything
                learned until you can explain it.
              </span>
            </div>
            <div className='diff-row'>
              <span className='k'>Not an AI summariser</span>
              <span className='v'>
                Summarisers think for you. Kibadist makes you do the thinking,
                then checks it.
              </span>
            </div>
            <div className='diff-row'>
              <span className='k'>Not flashcards</span>
              <span className='v'>
                Flashcards drill recall of facts. Kibadist tests whether you
                understand a concept — and can connect and apply it.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* §II · PRODUCT DEMO NARRATIVE */}
      <div className='demo-wrap' id='how-it-works'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § II<small>How It Works</small>
            </div>
            <div>
              <div className='section-label'>From source to understanding</div>
              <h2 className='sec-title'>
                Seven steps from a saved link to <em>a concept you own.</em>
              </h2>
              <p className='sec-lede'>
                Bring in anything you&apos;re trying to learn. Kibadist breaks
                it down, then walks you through proving you understand it.
              </p>
            </div>
          </div>

          <ol className='demo-steps'>
            <li className='demo-step'>
              <div className='ds-num'>1</div>
              <div className='ds-body'>
                <h4>Import an article, tutorial, note, or transcript.</h4>
                <p>
                  Paste a link, drop a PDF, or bring your own notes. Anything
                  you meant to learn from.
                </p>
                <div className='ds-visual'>
                  <span className='chip'>article.url</span>
                  <span className='chip'>tutorial.md</span>
                  <span className='chip'>paper.pdf</span>
                  <span className='chip'>transcript.txt</span>
                </div>
              </div>
            </li>
            <li className='demo-step'>
              <div className='ds-num'>2</div>
              <div className='ds-body'>
                <h4>Kibadist extracts key concepts.</h4>
                <p>
                  The source is parsed into discrete, learnable concepts — the
                  ideas worth understanding, separated from the noise.
                </p>
                <div className='ds-visual'>
                  <span className='node-chip'>Closure</span>
                  <span className='node-chip'>Event Loop</span>
                  <span className='node-chip on'>React State</span>
                  <span className='node-chip'>Hydration</span>
                </div>
              </div>
            </li>
            <li className='demo-step'>
              <div className='ds-num'>3</div>
              <div className='ds-body'>
                <h4>You select a concept worth learning deeply.</h4>
                <p>
                  You decide what matters. Pick the concept you actually need to
                  own — not everything, just what counts.
                </p>
                <div className='ds-visual'>
                  <span className='node-chip selected'>
                    React State <span className='tick'>✓ selected</span>
                  </span>
                </div>
              </div>
            </li>
            <li className='demo-step'>
              <div className='ds-num'>4</div>
              <div className='ds-body'>
                <h4>Kibadist creates a Living Concept draft.</h4>
                <p>
                  The concept gets a voice and a working metaphor — a structured
                  learning entity, drafted by AI and clearly marked as
                  unvalidated until you confirm it.
                </p>
                <div className='ds-visual ds-draft'>
                  <span className='draft-tag'>DRAFT · unvalidated</span>
                  <span className='draft-name'>
                    React State — The Signal Keeper
                  </span>
                </div>
              </div>
            </li>
            <li className='demo-step'>
              <div className='ds-num'>5</div>
              <div className='ds-body'>
                <h4>The concept asks questions and corrects misconceptions.</h4>
                <p>
                  It probes your understanding with Socratic prompts, surfaces
                  where your mental model is shaky, and points out where the
                  metaphor breaks down.
                </p>
                <div className='ds-visual'>
                  <div className='socratic-q'>
                    What actually happens if you mutate state directly?
                  </div>
                </div>
              </div>
            </li>
            <li className='demo-step'>
              <div className='ds-num'>6</div>
              <div className='ds-body'>
                <h4>
                  You must explain it in your own words before validation.
                </h4>
                <p>
                  No copy-paste, no AI fill-in. You articulate the concept
                  yourself — that explanation is what turns a draft into earned
                  knowledge.
                </p>
                <div className='ds-visual'>
                  <div className='explain-box'>
                    <span className='caret'>›</span> your explanation…
                  </div>
                </div>
              </div>
            </li>
            <li className='demo-step'>
              <div className='ds-num'>7</div>
              <div className='ds-body'>
                <h4>Kibadist schedules retrieval practice.</h4>
                <p>
                  The concept comes back on a spaced schedule, so understanding
                  you earned once doesn&apos;t quietly decay.
                </p>
                <div className='ds-visual'>
                  <span className='sched-pill'>Today</span>
                  <span className='sched-pill'>+3d</span>
                  <span className='sched-pill'>+9d</span>
                  <span className='sched-pill'>+21d</span>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </div>

      {/* §III · LIVING CONCEPTS */}
      <section className='section' id='living-concepts'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § III<small>Living Concepts</small>
            </div>
            <div>
              <div className='section-label'>Concepts that talk back</div>
              <h2 className='sec-title'>
                Each idea becomes a concept that{' '}
                <em>questions and corrects you.</em>
              </h2>
              <p className='sec-lede'>
                A Living Concept is not a mascot or a cartoon. It is a
                structured learning entity that helps you remember, explain,
                test, and repair your understanding of a single idea.
              </p>
            </div>
          </div>

          <div className='lc-layout'>
            <article className='concept-card'>
              <div className='cc-head'>
                <span className='cc-kind'>Living Concept</span>
                <span className='cc-state'>DRAFT · unvalidated</span>
              </div>
              <h3 className='cc-title'>React State — The Signal Keeper</h3>
              <blockquote className='cc-voice'>
                I hold changing information inside a component. When you update
                me properly, I signal React that the screen may need to change.
                If you mutate me directly, I may change silently, and React may
                not know to redraw.
              </blockquote>
              <div className='cc-socratic'>
                <span className='cc-socratic-label'>Socratic prompt</span>
                <p>
                  Now explain why direct state mutation is dangerous in your own
                  words.
                </p>
                <div className='cc-answerbox'>
                  <span className='caret'>›</span> your answer…
                </div>
              </div>
            </article>

            <div className='lc-aside'>
              <p className='lc-lead'>
                The same treatment applies to the concepts software learners hit
                first:
              </p>
              <div className='lc-examples'>
                <span className='node-chip'>React State</span>
                <span className='node-chip'>Closure</span>
                <span className='node-chip'>Recursion</span>
                <span className='node-chip'>Async/Await</span>
                <span className='node-chip'>Database Index</span>
                <span className='node-chip'>Cache</span>
                <span className='node-chip'>API</span>
              </div>
              <p className='lc-note'>
                Each one helps you <strong>remember</strong> it,{' '}
                <strong>explain</strong> it, <strong>test</strong> whether you
                actually understand it, and <strong>repair</strong> the spots
                where you don&apos;t.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* §IV · PROOF OF LEARNING */}
      <section className='section' id='proof'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § IV<small>Proof of Learning</small>
            </div>
            <div>
              <div className='section-label'>The core principle</div>
              <h2 className='sec-title'>
                AI asks. <em>Humans answer.</em>
              </h2>
              <p className='sec-lede'>
                Kibadist never silently turns AI output into permanent
                knowledge. The AI can draft, question, and challenge — but a
                concept only becomes yours when you validate it.
              </p>
            </div>
          </div>

          <div className='proof-grid'>
            <div className='proof-item'>
              <div className='pf-num'>i</div>
              <h4>Explain it</h4>
              <p>
                You articulate the concept in your own words. That explanation,
                not the AI&apos;s, is what gets saved as understanding.
              </p>
            </div>
            <div className='proof-item'>
              <div className='pf-num'>ii</div>
              <h4>Answer retrieval prompts</h4>
              <p>
                The concept resurfaces and asks you to recall it cold. Passing,
                not re-reading, is what advances it.
              </p>
            </div>
            <div className='proof-item'>
              <div className='pf-num'>iii</div>
              <h4>Identify metaphor limits</h4>
              <p>
                Every model breaks somewhere. You mark where the metaphor stops
                holding — proof you understand the real mechanism, not just the
                analogy.
              </p>
            </div>
            <div className='proof-item'>
              <div className='pf-num'>iv</div>
              <h4>Connect concepts</h4>
              <p>
                You link the idea to what you already know. Connected concepts
                are retained better and reveal whether you truly grasp them.
              </p>
            </div>
          </div>

          <div className='proof-statement'>
            <p>
              Nothing the AI generates is trusted as permanent knowledge on its
              own. Drafts are clearly marked as drafts. <strong>You</strong> are
              the one who validates — by explaining, recalling, and connecting —
              and only then does a concept become part of what you know.
            </p>
          </div>
        </div>
      </section>

      {/* §V · BENEFITS */}
      <section className='section' id='benefits'>
        <div className='wrap'>
          <div className='sec-header'>
            <div className='sec-num'>
              § V<small>What You Get</small>
            </div>
            <div>
              <div className='section-label'>Outcomes</div>
              <h2 className='sec-title'>
                Turn the time you already spend with AI into{' '}
                <em>real learning.</em>
              </h2>
              <p className='sec-lede'>
                Not more notes. Not more summaries. Understanding you can
                recall, explain, and build on.
              </p>
            </div>
          </div>

          <div className='benefit-grid'>
            <div className='benefit'>
              <div className='b-mono'>i.</div>
              <h4>Remember concepts longer</h4>
              <p>Spaced retrieval keeps what you&apos;ve earned from fading.</p>
            </div>
            <div className='benefit'>
              <div className='b-mono'>ii.</div>
              <h4>Escape tutorial hell</h4>
              <p>
                Stop following along and start being able to rebuild it
                yourself.
              </p>
            </div>
            <div className='benefit'>
              <div className='b-mono'>iii.</div>
              <h4>Detect weak understanding</h4>
              <p>
                Socratic prompts surface the gaps you didn&apos;t know you had.
              </p>
            </div>
            <div className='benefit'>
              <div className='b-mono'>iv.</div>
              <h4>Repair misconceptions</h4>
              <p>
                The concept points out where your mental model is wrong, and
                helps you fix it.
              </p>
            </div>
            <div className='benefit'>
              <div className='b-mono'>v.</div>
              <h4>Build a connected concept graph</h4>
              <p>
                Ideas link to ideas, so your knowledge compounds instead of
                scattering.
              </p>
            </div>
            <div className='benefit'>
              <div className='b-mono'>vi.</div>
              <h4>Turn AI usage into real learning</h4>
              <p>
                The hours you spend with AI finally leave something behind in
                your head.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* §VI · FINAL CTA */}
      <section className='cta-section' id='join'>
        <div className='wrap'>
          <div className='stamp-frame'>
            <span className='stamp-corner tl' />
            <span className='stamp-corner tr' />
            <span className='stamp-corner bl' />
            <span className='stamp-corner br' />

            <div className='section-label' style={{ justifyContent: 'center' }}>
              Early Access · Waitlist
            </div>
            <h2>
              Stop saving knowledge.
              <br />
              <em>Start proving you understand it.</em>
            </h2>
            <p>
              Join the waitlist for early access. Built for software learners
              who are tired of forgetting everything they read.
            </p>

            <div className='cta-form'>
              <WaitlistForm source='landing-footer' variant='dark' />
            </div>

            <div className='meta'>
              Already have an account? <Link href='/login'>Sign in</Link>
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
              The proof-of-learning workspace for people who learn with AI. Set
              in <em>Fraunces</em> and <em>Newsreader</em>, with deepest respect
              for the practice of slow, deliberate understanding.
            </div>

            <div>
              <h5>The Product</h5>
              <ul>
                <li>
                  <a href='#problem'>The Problem</a>
                </li>
                <li>
                  <a href='#how-it-works'>How It Works</a>
                </li>
                <li>
                  <a href='#living-concepts'>Living Concepts</a>
                </li>
                <li>
                  <a href='#proof'>Proof of Learning</a>
                </li>
              </ul>
            </div>

            <div>
              <h5>Learn More</h5>
              <ul>
                <li>
                  <a href='#benefits'>Benefits</a>
                </li>
                <li>
                  <a href='#how-it-works'>The seven steps</a>
                </li>
                <li>
                  <a href='#join'>Join the waitlist</a>
                </li>
              </ul>
            </div>

            <div>
              <h5>Account</h5>
              <ul>
                <li>
                  <a href='mailto:hello@kibadist.co'>hello@kibadist.co</a>
                </li>
                <li>
                  <a href='#join'>Join the waitlist</a>
                </li>
                <li>
                  <Link href='/login'>Sign in</Link>
                </li>
              </ul>
            </div>
          </div>

          <div className='footer-rule'>
            <span>© MMXXVI · Kibadist</span>
            <span>
              Don&apos;t just save knowledge. Prove you understand it.
            </span>
            <span>Proof of Learning · AI asks, humans answer</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
