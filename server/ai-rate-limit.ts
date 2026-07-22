export type AiRateLimitConfig = {
  globalLimit: number
  perUserLimit: number
  windowMs: number
}

export type AiConcurrencyLimitConfig = {
  globalLimit: number
  perUserLimit: number
}

const defaultGlobalLimit = 30
const defaultPerUserLimit = 5
const defaultWindowMs = 60_000

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function readAiRateLimitConfig(
  environment: Record<string, string | undefined> = process.env,
): AiRateLimitConfig {
  return {
    globalLimit: positiveInteger(environment.AI_GLOBAL_RATE_LIMIT, defaultGlobalLimit),
    perUserLimit: positiveInteger(environment.AI_RATE_LIMIT, defaultPerUserLimit),
    windowMs: positiveInteger(environment.AI_RATE_WINDOW_MS, defaultWindowMs),
  }
}

export function createAiRateLimiter(
  config: AiRateLimitConfig,
  now: () => number = Date.now,
) {
  const userRequests = new Map<number, number[]>()
  let globalRequests: number[] = []

  function currentRequests(userId: number) {
    const currentTime = now()
    const windowStart = currentTime - config.windowMs
    const recentUserRequests = (userRequests.get(userId) ?? [])
      .filter((requestTime) => requestTime > windowStart)
    globalRequests = globalRequests.filter((requestTime) => requestTime > windowStart)
    userRequests.set(userId, recentUserRequests)
    return { currentTime, recentUserRequests }
  }

  function hasCapacity(userId: number) {
    const { recentUserRequests } = currentRequests(userId)
    return recentUserRequests.length < config.perUserLimit &&
      globalRequests.length < config.globalLimit
  }

  return {
    canAllow(userId: number) {
      return hasCapacity(userId)
    },
    allow(userId: number) {
      const { currentTime, recentUserRequests } = currentRequests(userId)

      if (
        recentUserRequests.length >= config.perUserLimit ||
        globalRequests.length >= config.globalLimit
      ) {
        return false
      }

      recentUserRequests.push(currentTime)
      globalRequests.push(currentTime)
      userRequests.set(userId, recentUserRequests)
      return true
    },
  }
}

export function createAiConcurrencyLimiter(config: AiConcurrencyLimitConfig) {
  if (
    !Number.isSafeInteger(config.globalLimit) ||
    config.globalLimit <= 0 ||
    !Number.isSafeInteger(config.perUserLimit) ||
    config.perUserLimit <= 0
  ) {
    throw new Error('AI concurrency limits must be positive integers')
  }
  const activeByUser = new Map<number, number>()
  let activeGlobal = 0

  return {
    acquire(userId: number) {
      const activeForUser = activeByUser.get(userId) ?? 0
      if (activeForUser >= config.perUserLimit || activeGlobal >= config.globalLimit) return null
      activeByUser.set(userId, activeForUser + 1)
      activeGlobal += 1
      let released = false
      return () => {
        if (released) return
        released = true
        activeGlobal -= 1
        const remaining = (activeByUser.get(userId) ?? 1) - 1
        if (remaining > 0) activeByUser.set(userId, remaining)
        else activeByUser.delete(userId)
      }
    },
  }
}
