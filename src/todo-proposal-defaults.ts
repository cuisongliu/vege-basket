export type TodoProposalBatchReviewStatus = 'confirmed' | 'discarded' | 'pending'

export function defaultTodoProposalDueDate(
  dueDate: string | null,
  status: TodoProposalBatchReviewStatus,
  now = new Date(),
) {
  if (dueDate || status !== 'pending') return dueDate

  const parts = new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}
