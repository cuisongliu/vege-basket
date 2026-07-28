import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOrganizationInvitationCard,
  buildOrganizationInvitationStatusCard,
} from './organization-cards.ts'

test('organization invitation card exposes accept and decline actions', () => {
  const card = buildOrganizationInvitationCard({
    invitationId: 17,
    inviterName: '管理员',
    organizationName: '测试组织',
    token: 'invite-token',
  })
  const serialized = JSON.stringify(card)

  assert.match(serialized, /organization_invitation_accept/u)
  assert.match(serialized, /organization_invitation_decline/u)
})

test('accepted organization invitation card keeps only a disabled joined state', () => {
  const card = buildOrganizationInvitationStatusCard({
    organizationName: '测试组织',
    status: 'accepted',
  })
  const action = card.elements.find((element) => element.tag === 'action') as {
    actions: Array<{ disabled?: boolean; text: { content: string }; value?: unknown }>
  }

  assert.equal(action.actions.length, 1)
  assert.equal(action.actions[0].disabled, true)
  assert.equal(action.actions[0].text.content, '已加入')
  assert.equal('value' in action.actions[0], false)
  assert.doesNotMatch(JSON.stringify(card), /拒绝/u)
})

test('declined organization invitation card cannot be actioned again', () => {
  const card = buildOrganizationInvitationStatusCard({
    organizationName: '测试组织',
    status: 'declined',
  })
  const serialized = JSON.stringify(card)

  assert.match(serialized, /已拒绝/u)
  assert.doesNotMatch(serialized, /organization_invitation_(?:accept|decline)/u)
})
