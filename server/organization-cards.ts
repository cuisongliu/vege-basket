type OrganizationInvitationStatus = 'accepted' | 'declined'

export function buildOrganizationInvitationCard(params: {
  invitationId: number
  inviterName: string
  organizationName: string
  token: string
}) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          content: `**${params.inviterName}** 邀请你加入组织 **${params.organizationName}**。\n确认后，你会成为组织成员。`,
          tag: 'lark_md',
        },
      },
      {
        actions: [
          {
            tag: 'button',
            text: { content: '确认加入', tag: 'plain_text' },
            type: 'primary',
            value: {
              action: 'organization_invitation_accept',
              invitationId: params.invitationId,
              token: params.token,
            },
          },
          {
            tag: 'button',
            text: { content: '拒绝', tag: 'plain_text' },
            type: 'default',
            value: {
              action: 'organization_invitation_decline',
              invitationId: params.invitationId,
              token: params.token,
            },
          },
        ],
        tag: 'action',
      },
      {
        tag: 'note',
        elements: [{ content: '邀请在 72 小时后失效。', tag: 'plain_text' }],
      },
    ],
    header: {
      template: 'green',
      title: { content: 'Veges 组织邀请', tag: 'plain_text' },
    },
  }
}

export function buildOrganizationInvitationStatusCard(params: {
  organizationName: string
  status: OrganizationInvitationStatus
}) {
  const accepted = params.status === 'accepted'
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          content: accepted
            ? `你已成功加入组织 **${params.organizationName}**。`
            : `你已拒绝加入组织 **${params.organizationName}**。`,
          tag: 'lark_md',
        },
      },
      {
        actions: [{
          disabled: true,
          tag: 'button',
          text: { content: accepted ? '已加入' : '已拒绝', tag: 'plain_text' },
          type: 'default',
        }],
        tag: 'action',
      },
    ],
    header: {
      template: accepted ? 'green' : 'grey',
      title: { content: 'Veges 组织邀请', tag: 'plain_text' },
    },
  }
}
