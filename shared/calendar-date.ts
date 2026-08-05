/**
 * Format a PostgreSQL `date` value without allowing UTC serialization to shift
 * the calendar day. The application calendar is Shanghai time.
 */
export function formatShanghaiCalendarDate(value: Date | string | null | undefined) {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(value)
}
