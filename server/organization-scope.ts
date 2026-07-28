export function managedOrganizationReadScopeSql(
  organizationIdExpression: string,
  userIdPlaceholder = '$1',
) {
  return `(
    ${organizationIdExpression} is not null
    and exists(
      select 1
      from user_roles organization_admin_role
      where organization_admin_role.user_id = ${userIdPlaceholder}
        and organization_admin_role.role = 'organization_admin'
    )
    and exists(
      select 1
      from organization_memberships managed_organization
      where managed_organization.organization_id = ${organizationIdExpression}
        and managed_organization.user_id = ${userIdPlaceholder}
        and managed_organization.status = 'active'
        and managed_organization.access_role in ('owner', 'admin')
    )
  )`
}

export function testSpaceMembershipPresentSql(alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/iu.test(alias)) {
    throw new Error('Test-space membership alias must be a SQL identifier')
  }
  return `${alias}.test_space_id is not null`
}
