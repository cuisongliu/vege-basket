type PoolErrorSource = {
  on: (event: 'error', listener: (error: unknown) => void) => unknown
}

type PoolErrorReporter = (message: string) => void

export function databasePoolErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'UNKNOWN'
  const code = String(error.code ?? '').trim()
  return /^[A-Z0-9_]{1,32}$/u.test(code) ? code : 'UNKNOWN'
}

export function registerDatabasePoolErrorHandler(
  pool: PoolErrorSource,
  report: PoolErrorReporter = (message) => console.error(message),
) {
  pool.on('error', (error) => {
    report(`[database] discarded an idle PostgreSQL connection after ${databasePoolErrorCode(error)}`)
  })
}
