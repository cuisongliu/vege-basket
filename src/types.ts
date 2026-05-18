export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
export type Priority = 'high' | 'medium' | 'low'

export type JournalEntry = {
  id: number
  createdAt: string
  content: string
}

export type Todo = {
  id: number
  projectId: number
  title: string
  dueDate: string
  priority: Priority
  done: boolean
}

export type InboxItem = {
  id: number
  source: 'manual' | 'feishu'
  content: string
  createdAt: string
  suggestedProjectId?: number
  processed: boolean
}

export type Summary = {
  id: number
  projectId: number
  type: 'weekly' | 'monthly'
  title: string
  period: string
  content: string
  createdAt: string
}

export type Project = {
  id: number
  name: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  tags: string[]
  journals: JournalEntry[]
  risks: string[]
}
