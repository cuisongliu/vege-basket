import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAssumeUserRole,
  getSwitchableUserRoles,
  isSwitchableUserRole,
} from './roles.ts'

test('organization administrator is an additive capability, not a switchable role', () => {
  assert.equal(isSwitchableUserRole('organization_admin'), false)
  assert.deepEqual(
    getSwitchableUserRoles(['organization_admin']),
    ['developer', 'tester', 'delivery'],
  )
})

test('organization administrator can assume every business role', () => {
  assert.equal(canAssumeUserRole(['organization_admin'], 'developer'), true)
  assert.equal(canAssumeUserRole(['organization_admin'], 'tester'), true)
  assert.equal(canAssumeUserRole(['organization_admin'], 'delivery'), true)
  assert.equal(canAssumeUserRole(['tester'], 'developer'), false)
})
