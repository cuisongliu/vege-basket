import type { PoolClient } from 'pg'
import type { BugStatus } from './test-workbench-policy.ts'

export type BugVerifierReassignment = {
  bugId: number
  nextStatus: BugStatus
  nextVerifierUserId: number | null
  previousStatus: BugStatus
  previousVerifierUserId: number
}

/** Lock the organization before the test-space row and recheck the attachment. */
export async function lockBugVerifierSpace(client: Pick<PoolClient, 'query'>, spaceId: number) {
  const snapshot = await client.query<{ organization_id: string | null }>(
    'select organization_id from test_spaces where id = $1',
    [spaceId],
  )
  if (!snapshot.rows[0]) return null
  const organizationId = snapshot.rows[0].organization_id
  if (organizationId) {
    await client.query('select id from organizations where id = $1 for share', [organizationId])
  }
  const locked = await client.query<{ organization_id: string | null; owner_user_id: string }>(
    'select organization_id, owner_user_id from test_spaces where id = $1 for update',
    [spaceId],
  )
  if (!locked.rows[0] || locked.rows[0].organization_id !== organizationId) return null
  return {
    organizationId: organizationId ? Number(organizationId) : null,
    ownerUserId: Number(locked.rows[0].owner_user_id),
  }
}

export async function isEligibleBugVerifier(
  client: Pick<PoolClient, 'query'>,
  spaceId: number,
  userId: number | null,
) {
  if (!userId) return false
  const result = await client.query<{ eligible: boolean }>(
    `select exists(
       select 1
       from users account
       join user_roles role
         on role.user_id = account.id and role.role in ('tester', 'organization_admin')
       join test_space_memberships membership
         on membership.user_id = account.id
        and membership.test_space_id = $1
        and membership.status = 'active'
        and membership.access_level in ('owner', 'editor')
       where account.id = $2 and account.account_status = 'active'
     ) as eligible`,
    [spaceId, userId],
  )
  return Boolean(result.rows[0]?.eligible)
}

export async function canTransferBugVerifier(
  client: Pick<PoolClient, 'query'>,
  spaceId: number,
  userId: number,
  currentVerifierUserId: number | null,
) {
  if (currentVerifierUserId === userId) return true
  const result = await client.query<{ allowed: boolean }>(
    `select exists(
       select 1
       from test_spaces space
       where space.id = $1
         and (
           space.owner_user_id = $2
           or (
             space.organization_id is not null
             and exists(
               select 1
               from organization_memberships membership
               join user_roles role
                 on role.user_id = membership.user_id and role.role = 'organization_admin'
               where membership.organization_id = space.organization_id
                 and membership.user_id = $2
                 and membership.status = 'active'
                 and membership.access_role in ('owner', 'admin')
             )
           )
         )
     ) as allowed`,
    [spaceId, userId],
  )
  return Boolean(result.rows[0]?.allowed)
}

export async function findBugVerifierFallback(
  client: Pick<PoolClient, 'query'>,
  spaceId: number,
  excludedUserId: number,
) {
  const result = await client.query<{ id: string }>(
    `select account.id
       from test_spaces space
       join test_space_memberships membership
         on membership.test_space_id = space.id
        and membership.status = 'active'
        and membership.access_level in ('owner', 'editor')
       join users account on account.id = membership.user_id and account.account_status = 'active'
       join user_roles role
         on role.user_id = account.id and role.role in ('tester', 'organization_admin')
      where space.id = $1 and account.id <> $2
        and (
          account.id = space.owner_user_id
          or (
            role.role = 'organization_admin'
            and exists(
              select 1
              from organization_memberships organization_member
              where organization_member.organization_id = space.organization_id
                and organization_member.user_id = account.id
                and organization_member.status = 'active'
                and organization_member.access_role in ('owner', 'admin')
            )
          )
        )
      order by (account.id = space.owner_user_id) desc, account.id
      limit 1
      for share of space, membership, account, role`,
    [spaceId, excludedUserId],
  )
  return result.rows[0] ? Number(result.rows[0].id) : null
}

export async function reassignBugsForVerifierLoss(
  client: Pick<PoolClient, 'query'>,
  input: { actorUserId: number; spaceId: number; verifierUserId: number },
) {
  const bugs = await client.query<{ id: string; status: BugStatus }>(
    `select id, status
       from test_bugs
      where test_space_id = $1 and verifier_user_id = $2
      order by id
      for update`,
    [input.spaceId, input.verifierUserId],
  )
  if (bugs.rows.length === 0) return []
  const fallbackUserId = await findBugVerifierFallback(client, input.spaceId, input.verifierUserId)
  const changes: BugVerifierReassignment[] = []
  for (const bug of bugs.rows) {
    if (bug.status === 'closed') continue
    const nextStatus: BugStatus = !fallbackUserId && bug.status === 'pending_verification'
      ? 'pending_confirmation'
      : bug.status
    await client.query(
      `update test_bugs
          set verifier_user_id = $1, status = $2, updated_at = now()
        where id = $3 and verifier_user_id = $4`,
      [fallbackUserId, nextStatus, bug.id, input.verifierUserId],
    )
    await client.query(
      `insert into test_bug_events
         (test_bug_id, event_type, actor_user_id, previous_verifier_user_id, next_verifier_user_id,
          transfer_source)
       values ($1, 'verifier_transferred', $2, $3, $4, 'offboarding')`,
      [bug.id, input.actorUserId, input.verifierUserId, fallbackUserId],
    )
    if (nextStatus !== bug.status) {
      await client.query(
        `insert into test_bug_events
           (test_bug_id, event_type, actor_user_id, previous_status, next_status)
         values ($1, 'status_changed', $2, $3, $4)`,
        [bug.id, input.actorUserId, bug.status, nextStatus],
      )
    }
    changes.push({
      bugId: Number(bug.id),
      nextStatus,
      nextVerifierUserId: fallbackUserId,
      previousStatus: bug.status,
      previousVerifierUserId: input.verifierUserId,
    })
  }
  return changes
}

export async function reassignBugsForVerifierLossAcrossSpaces(
  client: Pick<PoolClient, 'query'>,
  input: { actorUserId: number; verifierUserId: number },
) {
  const spaces = await client.query<{ id: string; organization_id: string | null }>(
    `select distinct space.id, space.organization_id
       from test_bugs bug
       join test_spaces space on space.id = bug.test_space_id
      where bug.verifier_user_id = $1
      order by space.id`,
    [input.verifierUserId],
  )
  const organizationIds = [...new Set(spaces.rows
    .map((space) => space.organization_id ? Number(space.organization_id) : null)
    .filter((id): id is number => id !== null))].sort((left, right) => left - right)
  if (organizationIds.length > 0) {
    await client.query(
      'select id from organizations where id = any($1::bigint[]) order by id for share',
      [organizationIds],
    )
  }
  const changes: BugVerifierReassignment[] = []
  for (const space of spaces.rows) {
    if (!await lockBugVerifierSpace(client, Number(space.id))) continue
    changes.push(...await reassignBugsForVerifierLoss(client, {
      actorUserId: input.actorUserId,
      spaceId: Number(space.id),
      verifierUserId: input.verifierUserId,
    }))
  }
  return changes
}
