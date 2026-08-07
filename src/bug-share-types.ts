export type BugShareComment = {
  authorName: string
  content: string
  createdAt: string
  id: number
}

export type BugShareMentionableMember = {
  id: number
  name: string
}

export type BugShareView = {
  assigneeName: string | null
  bugId: number
  comments: BugShareComment[]
  createdAt: string
  environment: string
  expectedResult: string
  actualResult: string
  mentionableMembers: BugShareMentionableMember[]
  priority: string
  projectName: string | null
  reproductionSteps: string
  severity: string
  status: string
  testPlanName: string | null
  testSpaceName: string
  testSubjectName: string
  title: string
  updatedAt: string
  viewer: 'anonymous' | 'commenter' | 'assignee'
}

export type BugShareLink = {
  expiresInDays: number
  url: string
}
