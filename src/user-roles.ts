import type { UserRole } from './api'

export const userRoleLabel: Record<UserRole, string> = {
  delivery: '交付工程师',
  developer: '开发工程师',
  organization_admin: '组织管理员',
  tester: '测试工程师',
}

export type SwitchableUserRole = Exclude<UserRole, 'organization_admin'>

export const switchableUserRoles: SwitchableUserRole[] = ['developer', 'tester', 'delivery']

export function hasOrganizationAdminRole(roles: readonly UserRole[]) {
  return roles.includes('organization_admin')
}

export function getSwitchableUserRoles(roles: readonly UserRole[]): SwitchableUserRole[] {
  if (hasOrganizationAdminRole(roles)) return [...switchableUserRoles]
  return switchableUserRoles.filter((role) => roles.includes(role))
}
