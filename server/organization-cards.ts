type OrganizationInvitationStatus = 'accepted' | 'declined'
export type ProjectTransferStatus = 'accepted' | 'declined' | 'expired'

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

export function buildProjectTransferRequestCard(params: {
  organizationName: string
  projectName: string
  requesterName: string
  targetName: string
  token: string
  transferId: number
}) {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          content: [
            `**${params.requesterName}** 想把项目 **${params.projectName}** 的归属权转移给你。`,
            `组织：${params.organizationName}`,
            `接收人：${params.targetName}`,
            '同意后你会成为项目 Owner，原 Owner 会保留项目成员访问权限。',
          ].join('\n'),
          tag: 'lark_md',
        },
      },
      {
        actions: [
          {
            tag: 'button',
            text: { content: '同意', tag: 'plain_text' },
            type: 'primary',
            value: {
              action: 'project_transfer_accept',
              token: params.token,
              transferId: params.transferId,
            },
          },
          {
            tag: 'button',
            text: { content: '拒绝', tag: 'plain_text' },
            type: 'default',
            value: {
              action: 'project_transfer_decline',
              token: params.token,
              transferId: params.transferId,
            },
          },
        ],
        tag: 'action',
      },
      {
        tag: 'note',
        elements: [{ content: '转移申请在 72 小时后失效。', tag: 'plain_text' }],
      },
    ],
    header: {
      template: 'green',
      title: { content: 'Veges 项目转移', tag: 'plain_text' },
    },
  }
}

export function buildProjectTransferStatusCard(params: {
  projectName: string
  status: ProjectTransferStatus
}) {
  const statusCopy = {
    accepted: '已同意',
    declined: '已拒绝',
    expired: '已过期',
  } satisfies Record<ProjectTransferStatus, string>
  const accepted = params.status === 'accepted'
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: {
          content: accepted
            ? `你已同意接手项目 **${params.projectName}**。`
            : params.status === 'expired'
              ? `项目 **${params.projectName}** 的转移申请已过期。`
              : `你已拒绝接手项目 **${params.projectName}**。`,
          tag: 'lark_md',
        },
      },
      {
        actions: [{
          disabled: true,
          tag: 'button',
          text: { content: statusCopy[params.status], tag: 'plain_text' },
          type: 'default',
        }],
        tag: 'action',
      },
    ],
    header: {
      template: accepted ? 'green' : 'grey',
      title: { content: 'Veges 项目转移', tag: 'plain_text' },
    },
  }
}
