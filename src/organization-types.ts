import type { UserRole } from './api'

export type OrganizationAccessRole = 'owner' | 'admin' | 'member'

export type OrganizationListItem = {
  accessRole: OrganizationAccessRole
  id: number
  memberCount: number
  name: string
}

export type OrganizationMember = {
  accessRole: OrganizationAccessRole
  displayName: string
  id: number
  joinedAt: string
  roles: UserRole[]
  username: string
}

export type OrganizationProject = {
  id: number
  name: string
  openTodoCount: number
  ownerName: string
  status: string
  todoCount: number
  updatedAt: string
}

export type OrganizationTestSpace = {
  bugCount: number
  id: number
  name: string
  ownerName: string
  planCount: number
  updatedAt: string
}

export type OrganizationTask = {
  assigneeName: string
  id: number
  kind: 'bug' | 'delivery' | 'todo'
  projectId?: number
  projectName: string
  status: string
  title: string
  updatedAt: string
}

export type OrganizationWeeklyReport = {
  content: string
  memberName: string
  status: 'draft' | 'submitted'
  submittedAt?: string
  updatedAt: string
  userId: number
  weekStart: string
}

export type OrganizationWeeklySummary = {
  content: string
  createdAt: string
  sourceReportCount: number
  weekStart: string
}

export type OrganizationDetail = {
  accessRole: OrganizationAccessRole
  attachableProjects: Array<{ id: number; name: string; status: string }>
  attachableTestSpaces: Array<{ id: number; name: string }>
  canManage: boolean
  createdAt: string
  id: number
  invitations: Array<{
    createdAt: string
    id: number
    lastError: string
    status: string
    targetEmail: string
  }>
  members: OrganizationMember[]
  name: string
  ownerUserId: number
  projects: OrganizationProject[]
  reports: OrganizationWeeklyReport[]
  summaries: OrganizationWeeklySummary[]
  tasks: OrganizationTask[]
  testSpaces: OrganizationTestSpace[]
  weekStartsOn: number
}
