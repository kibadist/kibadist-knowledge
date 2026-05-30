import { UserThrottlerGuard } from './user-throttler.guard'

// getTracker is protected; expose it through a thin subclass for the test.
class TestableGuard extends UserThrottlerGuard {
  track(req: Record<string, unknown>) {
    return this.getTracker(req)
  }
}

function makeGuard() {
  // getTracker touches no constructor deps (options/storage/reflector), so we
  // build the instance without the Nest DI container.
  return Object.create(TestableGuard.prototype) as TestableGuard
}

describe('UserThrottlerGuard.getTracker', () => {
  it('keys on the authenticated user id when req.user is set', async () => {
    const guard = makeGuard()
    const tracker = await guard.track({
      user: { userId: 'user-123', email: 'a@b.co' },
      ip: '203.0.113.7',
    })
    expect(tracker).toBe('user-123')
  })

  it('falls back to the client IP when there is no authenticated user', async () => {
    const guard = makeGuard()
    const tracker = await guard.track({ ip: '203.0.113.7' })
    expect(tracker).toBe('203.0.113.7')
  })

  it('falls back to "unknown" when neither user nor ip is present', async () => {
    const guard = makeGuard()
    const tracker = await guard.track({})
    expect(tracker).toBe('unknown')
  })
})
