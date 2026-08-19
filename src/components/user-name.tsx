import { Badge } from '@/components/ui/badge'

export function UserName({
  className,
  departedUserIds,
  name,
  userId,
}: {
  className?: string
  departedUserIds?: readonly number[]
  name?: string | null
  userId?: number | null
}) {
  const displayName = name || '未知用户'
  const departed = userId != null && departedUserIds?.includes(userId)
  return (
    <span className={className}>
      {displayName}
      {departed ? <Badge variant="secondary" className="user-departed-badge">已离职</Badge> : null}
    </span>
  )
}
