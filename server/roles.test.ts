import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAssumeUserRole,
  getSwitchableUserRoles,
  isUserRole,
  isSwitchableUserRole,
} from './roles.ts'

test('organization administrator is an additive capability, not a switchable role', () => {
  assert.equal(isSwitchableUserRole('organization_admin'), false)
  assert.deepEqual(
    getSwitchableUserRoles(['organization_admin']),
    ['developer', 'tester'],
  )
})

test('organization administrator can assume every business role', () => {
  assert.equal(canAssumeUserRole(['organization_admin'], 'developer'), true)
  assert.equal(canAssumeUserRole(['organization_admin'], 'tester'), true)
  assert.equal(canAssumeUserRole(['tester'], 'developer'), false)
})

test('delivery is no longer an account role', () => {
  assert.equal(isUserRole('delivery'), false)
  assert.equal(isSwitchableUserRole('delivery'), false)
})
