export type MyWorkKind = 'todo' | 'delivery' | 'bug' | 'milestone'
export type MyWorkRelation = 'assignee' | 'reviewer' | 'responsible'

export type MyWorkItem = {
  id: string
  kind: MyWorkKind
  sourceId: number
  projectId?: number
  projectName?: string
  contextName?: string
  creatorName?: string
  canComplete?: boolean
  title: string
  status: string
  priority?: 'high' | 'medium' | 'low'
  offboardingTransferredFromName?: string
  dueAt?: string
  updatedAt: string
  relation: MyWorkRelation
}

export type MyWorkSummary = {
  all: number
  overdue: number
  today: number
  thisWeek: number
}

export type MyWorkData = {
  organizationId: number | null
  items: MyWorkItem[]
  summary: MyWorkSummary
  nextCursor?: string
}

export type MyWorkFilters = {
  cursor?: string
  kind?: MyWorkKind
  projectId?: number
  creator?: string
  q?: string
  /** `open` and `all` are built-in views; other values select a concrete item status. */
  status?: string
  sort?: 'due_asc' | 'due_desc'
  limit?: number
}
