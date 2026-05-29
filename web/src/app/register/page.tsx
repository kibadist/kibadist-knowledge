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
    <main className='flex min-h-screen items-center justify-center p-6'>
      <div className='w-full max-w-sm'>
        <h1 className='mb-1 text-2xl font-semibold'>Create your account</h1>
        <p className='mb-6 text-sm text-neutral-400'>
          Start building durable understanding
        </p>
        <form onSubmit={onSubmit} className='flex flex-col gap-3'>
          <input
            type='text'
            placeholder='Name (optional)'
            value={name}
            onChange={(e) => setName(e.target.value)}
            className='rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400'
          />
          <input
            type='email'
            placeholder='Email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className='rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400'
          />
          <input
            type='password'
            placeholder='Password (min 8 characters)'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className='rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400'
          />
          {error && <p className='text-sm text-red-400'>{error}</p>}
          <button
            type='submit'
            disabled={submitting}
            className='rounded-md bg-white px-3 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className='mt-4 text-sm text-neutral-400'>
          Already have an account?{' '}
          <Link href='/login' className='text-white underline'>
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
