const organizationParam = 'weeklyReportOrg'
const weekStartParam = 'weekStart'
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/

function positiveId(value: string | null) {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

function validIsoDate(value: string | null) {
  if (!value || !isoDatePattern.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null
}

export type WeeklyReportDeepLink =
  | { organizationId: null; status: 'absent'; weekStart: null }
  | { organizationId: null; status: 'invalid'; weekStart: null }
  | { organizationId: number; status: 'valid'; weekStart: string }

export function parseWeeklyReportDeepLink(search: string): WeeklyReportDeepLink {
  const params = new URLSearchParams(search)
  const rawOrganizationId = params.get(organizationParam)
  const rawWeekStart = params.get(weekStartParam)
  if (rawOrganizationId == null && rawWeekStart == null) {
    return { organizationId: null, status: 'absent', weekStart: null }
  }
  const organizationId = positiveId(rawOrganizationId)
  const weekStart = validIsoDate(rawWeekStart)
  return organizationId && weekStart
    ? { organizationId, status: 'valid', weekStart }
    : { organizationId: null, status: 'invalid', weekStart: null }
}

export function removeWeeklyReportDeepLink(search: string) {
  const params = new URLSearchParams(search)
  params.delete(organizationParam)
  params.delete(weekStartParam)
  const value = params.toString()
  return value ? `?${value}` : ''
}

export function appendWeeklyReportDeepLink(
  publicAppUrl: string,
  organizationId: number,
  weekStart: string,
) {
  const url = new URL(publicAppUrl)
  url.searchParams.set(organizationParam, String(organizationId))
  url.searchParams.set(weekStartParam, weekStart)
  return url.toString()
}
