'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && user) router.replace('/today')
  }, [user, loading, router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      router.replace('/today')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='kbapp'>
      <main
        className='page'
        style={{ paddingTop: '6rem', paddingBottom: '6rem' }}
      >
        <div style={{ maxWidth: '22rem', margin: '0 auto' }}>
          <div className='page-head' style={{ marginBottom: '1.5rem' }}>
            <span className='section-label'>§ Access</span>
            <h1>Welcome back</h1>
            <p className='lede'>Sign in to Kibadist Knowledge</p>
          </div>
          <div className='panel'>
            <form
              onSubmit={onSubmit}
              className='flex flex-col'
              style={{ gap: '0.75rem' }}
            >
              <input
                type='email'
                placeholder='Email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className='fld'
              />
              <input
                type='password'
                placeholder='Password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className='fld'
              />
              {error && <div className='notice notice-error'>{error}</div>}
              <button
                type='submit'
                disabled={submitting}
                className='btn-primary'
                style={{ marginTop: '0.25rem' }}
              >
                {submitting ? 'Signing in…' : 'Sign in'}{' '}
                <span className='ar'>→</span>
              </button>
            </form>
          </div>
          <p className='block-sub' style={{ marginTop: '1rem' }}>
            No account?{' '}
            <Link
              href='/register'
              className='text-accent'
              style={{ textDecoration: 'underline' }}
            >
              Create one
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
