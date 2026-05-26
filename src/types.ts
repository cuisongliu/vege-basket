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

export type Collaborator = {
  id: number
  name: string
  role: string
  projectId: number
}

export type Todo = {
  id: number
  projectId: number
  collaboratorId?: number
  createdByUserId?: number
  creatorName?: string
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
  status: 'active'
  memberName: string
  createdAt: string
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
