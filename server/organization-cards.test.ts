import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOrganizationInvitationCard,
  buildOrganizationInvitationStatusCard,
  buildProjectTransferRequestCard,
  buildProjectTransferStatusCard,
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

test('project transfer card exposes accept and decline actions', () => {
  const card = buildProjectTransferRequestCard({
    organizationName: '测试组织',
    projectName: '项目篮子',
    requesterName: '旧 Owner',
    targetName: '新 Owner',
    token: 'transfer-token',
    transferId: 42,
  })
  const serialized = JSON.stringify(card)

  assert.match(serialized, /project_transfer_accept/u)
  assert.match(serialized, /project_transfer_decline/u)
  assert.match(serialized, /项目转移/u)
})

test('project transfer status cards cannot be actioned again', () => {
  const card = buildProjectTransferStatusCard({
    projectName: '项目篮子',
    status: 'accepted',
  })
  const action = card.elements.find((element) => element.tag === 'action') as {
    actions: Array<{ disabled?: boolean; text: { content: string }; value?: unknown }>
  }

  assert.equal(action.actions.length, 1)
  assert.equal(action.actions[0].disabled, true)
  assert.equal(action.actions[0].text.content, '已同意')
  assert.equal('value' in action.actions[0], false)
  assert.doesNotMatch(JSON.stringify(card), /project_transfer_(?:accept|decline)/u)
})
