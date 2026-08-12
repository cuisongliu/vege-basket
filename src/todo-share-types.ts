export type TodoShareNote = {
  authorName: string
  content: string
  createdAt: string
  fromShare: boolean
  id: number
  kind: 'normal' | 'acceptance'
}

export type TodoShareView = {
  assigneeName: string | null
  confirmationStatus: string
  createdAt: string
  creatorName: string
  detail: string
  done: boolean
  dueDate: string
  mentionableMembers: Array<{ id: number; name: string }>
  moduleName: string | null
  notes: TodoShareNote[]
  priority: string
  projectName: string
  reviewerName: string | null
  title: string
  todoId: number
  updatedAt: string
  viewer: 'anonymous' | 'commenter' | 'member'
  watcherNames: string[]
}

export type TodoShareLink = {
  expiresInDays: number
  url: string
}
