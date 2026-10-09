import type {
  OrganizationDetail,
  OrganizationDetailSection,
  OrganizationProject,
} from './organization-types'

const allOrganizationDetailSections: OrganizationDetailSection[] = [
  'members',
  'overview',
  'packageMarket',
  'projects',
  'reports',
  'settings',
  'testSpaces',
]

export function organizationDetailSectionsForActiveSection(
  activeSection: OrganizationDetailSection,
) {
  return activeSection === 'overview'
    ? ['overview'] satisfies OrganizationDetailSection[]
    : ['overview', activeSection] satisfies OrganizationDetailSection[]
}

export function canApplyOrganizationDetail(
  expectedOrganizationId: number,
  selectedOrganizationId: number,
  nextDetail: OrganizationDetail,
) {
  return expectedOrganizationId === selectedOrganizationId
    && nextDetail.id === expectedOrganizationId
}

export function canApplyOrganizationDetailRead(
  requestVersion: number,
  currentVersion: number,
  expectedOrganizationId: number,
  selectedOrganizationId: number,
  nextDetail: OrganizationDetail,
) {
  return requestVersion === currentVersion
    && canApplyOrganizationDetail(
      expectedOrganizationId,
      selectedOrganizationId,
      nextDetail,
    )
}

function mergeOverviewProjects(
  current: OrganizationProject[],
  next: OrganizationProject[],
) {
  const currentById = new Map(current.map((project) => [project.id, project]))
  return next.map((project) => {
    const cached = currentById.get(project.id)
    if (!cached) return project
    return {
      ...project,
      memberships: cached.memberships,
      milestones: cached.milestones,
    }
  })
}

export function mergeOrganizationDetail(
  current: OrganizationDetail,
  next: OrganizationDetail,
) {
  const sections = new Set<OrganizationDetailSection>(
    next.loadedSections ?? allOrganizationDetailSections,
  )
  const loadedSections = current.loadedSections === undefined || next.loadedSections === undefined
    ? undefined
    : [...new Set([...current.loadedSections, ...sections])]
  const includes = (...candidates: OrganizationDetailSection[]) => (
    candidates.some((section) => sections.has(section))
  )
  const projects = sections.has('projects')
    ? next.projects
    : sections.has('overview')
      ? mergeOverviewProjects(current.projects, next.projects)
      : current.projects

  return {
    ...current,
    ...next,
    attachableProjects: includes('projects') ? next.attachableProjects : current.attachableProjects,
    attachableTestSpaces: includes('testSpaces') ? next.attachableTestSpaces : current.attachableTestSpaces,
    departedUserIds: includes('overview') ? next.departedUserIds : current.departedUserIds,
    invitations: includes('members', 'settings') ? next.invitations : current.invitations,
    loadedSections,
    members: includes('members', 'overview', 'projects', 'reports', 'settings', 'testSpaces')
      ? next.members
      : current.members,
    packageMarketPolicy: includes('packageMarket', 'settings')
      ? next.packageMarketPolicy
      : current.packageMarketPolicy,
    projects,
    projectModules: includes('settings') ? next.projectModules : current.projectModules,
    reports: includes('reports') ? next.reports : current.reports,
    summaries: includes('reports') ? next.summaries : current.summaries,
    tasks: includes('overview') ? next.tasks : current.tasks,
    testEnvironments: includes('testSpaces') ? next.testEnvironments : current.testEnvironments,
    testSpaces: includes('overview', 'testSpaces') ? next.testSpaces : current.testSpaces,
    weeklyReportAssignments: includes('reports', 'settings')
      ? next.weeklyReportAssignments
      : current.weeklyReportAssignments,
    weeklyReportProfiles: includes('reports', 'settings')
      ? next.weeklyReportProfiles
      : current.weeklyReportProfiles,
  }
}
