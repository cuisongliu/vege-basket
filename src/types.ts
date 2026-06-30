export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
export type Priority = 'high' | 'medium' | 'low'
export type ProjectAccessRole = 'owner' | 'member'
export type JournalVisibility = 'private' | 'public'

export type JournalEntry = {
  id: number
  createdAt: string
  content: string
  authorUserId?: number
  speakerName: string
  visibility: JournalVisibility
}

export type Todo = {
  id: number
  projectId: number
  createdByUserId?: number
  creatorName?: string
  assigneeUserId?: number
  assigneeName?: string
  assignedByUserId?: number
  assignedByName?: string
  title: string
  dueDate: string
  priority: Priority
  done: boolean
}

export type ProjectMembership = {
  id: number
  projectId: number
  invitedEmail: string
  invitedUserId?: number
  role: ProjectAccessRole
  status: 'pending' | 'active' | 'declined'
  memberName: string
  createdAt: string
}

export type NotificationState = {
  readAt?: string
  dismissedAt?: string
}

export type ProjectInviteNotification = NotificationState & {
  id: number
  projectId: number
  projectName: string
  invitedByName: string
  createdAt: string
}

export type TodoNotification = NotificationState & {
  id: number
  projectId: number
  projectName: string
  title: string
  dueDate: string
  priority: Priority
  done?: boolean
  assignedAt?: string
  assignedByName?: string
}

export type NotificationCenterData = {
  assignedTodos: TodoNotification[]
  dueTomorrowTodos: TodoNotification[]
  invites: ProjectInviteNotification[]
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
  projectId?: number
  type: 'weekly' | 'monthly'
  title: string
  period: string
  content: string
  createdAt: string
}

export type Project = {
  id: number
  accessRole: ProjectAccessRole
  name: string
  ownerName: string
  ownerUserId: number
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  tags: string[]
  journals: JournalEntry[]
  risks: string[]
}
