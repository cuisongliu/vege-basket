import assert from 'node:assert/strict'
import test from 'node:test'
import {
  managedOrganizationReadScopeSql,
  testSpaceMembershipPresentSql,
} from './organization-scope.ts'

test('managed organization scope requires resource administration membership', () => {
  const sql = managedOrganizationReadScopeSql('project.organization_id', '$2')

  assert.match(sql, /organization_admin_role\.role = 'organization_admin'/u)
  assert.match(sql, /managed_organization\.organization_id = project\.organization_id/u)
  assert.match(sql, /managed_organization\.user_id = \$2/u)
  assert.match(sql, /managed_organization\.status = 'active'/u)
  assert.match(sql, /managed_organization\.access_role in \('owner', 'admin'\)/u)
})

test('test-space membership presence uses its composite primary key', () => {
  assert.equal(testSpaceMembershipPresentSql('mine'), 'mine.test_space_id is not null')
  assert.throws(() => testSpaceMembershipPresentSql('mine.id'))
})
