import type { Priority, Project } from './types'
import type { UserRole } from './api'

export type TestCaseStatus = 'draft' | 'active' | 'archived'
export type TestCaseKind = 'functional' | 'baseline'
export type TestCaseType = 'functional' | 'regression' | 'smoke' | 'security' | 'performance'
export type TestPlanStatus = 'draft' | 'in_progress' | 'completed' | 'aborted'
export type TestResult = 'untested' | 'passed' | 'failed' | 'blocked' | 'skipped'
export type BugSeverity = 'blocker' | 'critical' | 'major' | 'minor' | 'trivial'
export type BugStatus =
  | 'new'
  | 'confirmed'
  | 'assigned'
  | 'in_progress'
  | 'pending_verification'
  | 'closed'
  | 'rejected'
  | 'duplicate'
  | 'reopened'

export type TestSpace = {
  accessLevel: 'owner' | 'editor' | 'viewer'
  createdAt: string
  id: number
  name: string
  ownerUserId: number
}

export type TestSpaceMembershipStatus = 'pending' | 'active' | 'declined'

export type TestSpaceMember = {
  accessLevel: 'owner' | 'editor' | 'viewer'
  createdAt: string
  displayName: string
  status: TestSpaceMembershipStatus
  userId: number
  username: string
}

export type ManagedTestSpace = {
  accessLevel: 'owner' | 'editor' | 'viewer'
  createdAt: string
  id: number
  members: TestSpaceMember[]
  name: string
  organizationId?: number
  organizationName?: string
  ownerUserId: number
}

export type TestSpaceOrganizationOption = {
  id: number
  name: string
}

export type TestSpaceInvitation = {
  accessLevel: 'editor' | 'viewer'
  createdAt: string
  invitedByName: string
  spaceId: number
  spaceName: string
}

export type TestSpaceSettings = {
  invitations: TestSpaceInvitation[]
  organizations: TestSpaceOrganizationOption[]
  spaces: ManagedTestSpace[]
}

export type TestSpaceInviteLink = {
  accessLevel: 'editor' | 'viewer'
  expiresAt: string
  expiresInMinutes: number
  passwordRequired: boolean
  token: string
}

export type TestSubject = {
  canDelete: boolean
  createdAt: string
  description: string
  environment: string
  id: number
  name: string
  testSpaceId: number
  versionLabel: string
}

export type TestCaseFolder = {
  createdAt: string
  id: number
  name: string
  testSpaceId: number
  testSubjectId: number
}

export type TestCase = {
  caseKind: TestCaseKind
  caseType: TestCaseType
  createdAt: string
  customTags: string[]
  expectedResult: string
  folderId?: number
  id: number
  preconditions: string
  priority: Priority
  remarks: string
  status: TestCaseStatus
  steps: string
  testSpaceId: number
  testSubjectId: number
  title: string
  updatedAt: string
}

export type TestPlan = {
  canManage: boolean
  createdAt: string
  createdByUserId?: number
  endsOn?: string
  environment: string
  id: number
  name: string
  ownerUserId?: number
  projectId?: number
  startsOn?: string
  status: TestPlanStatus
  testSpaceId: number
  testSubjectId: number
  testSubjectIds: number[]
  updatedAt: string
  versionLabel: string
}

export type TestPlanCase = {
  executedAt?: string
  executedByUserId?: number
  id: number
  result: TestResult
  resultNote: string
  snapshotCaseVersion: number
  snapshotExpectedResult: string
  snapshotPreconditions: string
  snapshotSteps: string
  snapshotTitle: string
  testCaseId?: number
  testPlanId: number
  testSubjectId?: number
}

export type TestBugComment = {
  authorName: string
  authorUserId?: number
  canEdit?: boolean
  content: string
  createdAt: string
  id: number
  updatedAt: string
}

export type TestBug = {
  actualResult: string
  assigneeUserId?: number
  canManage?: boolean
  comments: TestBugComment[]
  createdAt: string
  environment: string
  expectedResult: string
  id: number
  priority: Priority
  reporterUserId?: number
  reproductionSteps: string
  severity: BugSeverity
  status: BugStatus
  testPlanCaseId?: number
  testPlanId?: number
  testSpaceId: number
  testSubjectId?: number
  title: string
  updatedAt: string
}

export type TestWorkspaceUser = {
  displayName: string
  id: number
  roles: UserRole[]
  username: string
}

export type TestWorkbenchData = {
  bugs: TestBug[]
  cases: TestCase[]
  folders: TestCaseFolder[]
  planCases: TestPlanCase[]
  plans: TestPlan[]
  spaces: TestSpace[]
  subjects: TestSubject[]
  users: TestWorkspaceUser[]
}

export type TestWorkbenchProjectOption = Pick<Project, 'id' | 'name'>

export type TestCaseImportPreview = {
  levelCounts: Record<'P0' | 'P1' | 'P2', number>
  moduleCount: number
  rowCount: number
  sampleTitles: string[]
}
