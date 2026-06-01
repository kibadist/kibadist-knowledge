'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'

export default function RegisterPage() {
  const { user, loading, register } = useAuth()
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password, name || undefined)
      router.replace('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
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
            <h1>Create your account</h1>
            <p className='lede'>Start building durable understanding</p>
          </div>
          <div className='panel'>
            <form
              onSubmit={onSubmit}
              className='flex flex-col'
              style={{ gap: '0.75rem' }}
            >
              <input
                type='text'
                placeholder='Name (optional)'
                value={name}
                onChange={(e) => setName(e.target.value)}
                className='fld'
              />
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
                placeholder='Password (min 8 characters)'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className='fld'
              />
              {error && <div className='notice notice-error'>{error}</div>}
              <button
                type='submit'
                disabled={submitting}
                className='btn-primary'
                style={{ marginTop: '0.25rem' }}
              >
                {submitting ? 'Creating…' : 'Create account'}{' '}
                <span className='ar'>→</span>
              </button>
            </form>
          </div>
          <p className='block-sub' style={{ marginTop: '1rem' }}>
            Already have an account?{' '}
            <Link
              href='/login'
              className='text-accent'
              style={{ textDecoration: 'underline' }}
            >
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
