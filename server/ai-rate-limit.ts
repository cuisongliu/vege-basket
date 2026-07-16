export type AiRateLimitConfig = {
  globalLimit: number
  perUserLimit: number
  windowMs: number
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

  return {
    allow(userId: number) {
      const currentTime = now()
      const windowStart = currentTime - config.windowMs
      const recentUserRequests = (userRequests.get(userId) ?? [])
        .filter((requestTime) => requestTime > windowStart)
      globalRequests = globalRequests.filter((requestTime) => requestTime > windowStart)

      if (
        recentUserRequests.length >= config.perUserLimit ||
        globalRequests.length >= config.globalLimit
      ) {
        userRequests.set(userId, recentUserRequests)
        return false
      }

      recentUserRequests.push(currentTime)
      globalRequests.push(currentTime)
      userRequests.set(userId, recentUserRequests)
      return true
    },
  }
}
