import { useEffect, useState } from 'react'
import { ArrowRight, Buildings, Check, Code, Flask, UsersThree } from '@phosphor-icons/react'
import {
  fetchManagedUsers,
  updateManagedUserRoles,
  type AuthUser,
  type ManagedUser,
  type UserRole,
} from '@/api'
import {
  getSwitchableUserRoles,
  hasOrganizationAdminRole,
  userRoleLabel,
  type SwitchableUserRole,
} from '@/user-roles'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const roleIcon: Record<UserRole, typeof Code> = {
  developer: Code,
  organization_admin: Buildings,
  tester: Flask,
}

const roleDescription: Record<UserRole, string> = {
  developer: '项目工作区与指派给我的 Bug',
  organization_admin: '组织项目、里程碑、成员、任务与周报管理',
  tester: '用例、测试计划与 Bug 追踪',
}

export function UserRoleSelectionDialog({
  busy,
  onOpenOrganization,
  onSelect,
  open,
  user,
}: {
  busy: boolean
  onOpenOrganization: () => void
  onSelect: (role: SwitchableUserRole) => void
  open: boolean
  user: AuthUser
}) {
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="role-selection-dialog">
        <DialogHeader>
          <DialogTitle>选择本次登录身份</DialogTitle>
          <DialogDescription>身份决定本次会话中显示的工作区域，可以稍后从账户菜单切换。</DialogDescription>
        </DialogHeader>
        <div className="role-selection-list">
          {getSwitchableUserRoles(user.roles).map((role) => {
            const Icon = roleIcon[role]
            return (
              <button disabled={busy} key={role} type="button" onClick={() => onSelect(role)}>
                <Icon size={22} weight="duotone" />
                <span><strong>{userRoleLabel[role]}</strong><small>{roleDescription[role]}</small></span>
                {user.activeRole === role ? <Check /> : null}
              </button>
            )
          })}
          {hasOrganizationAdminRole(user.roles) ? (
            <button disabled={busy} type="button" onClick={onOpenOrganization}>
              <Buildings size={22} weight="duotone" />
              <span>
                <strong>{userRoleLabel.organization_admin}</strong>
                <small>{roleDescription.organization_admin}</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function UserRoleManagementDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [drafts, setDrafts] = useState<Record<number, UserRole[]>>({})
  const [busyUserId, setBusyUserId] = useState<number>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    fetchManagedUsers()
      .then((result) => {
        setUsers(result.users)
        setDrafts(Object.fromEntries(result.users.map((user) => [user.id, user.roles])))
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '用户读取失败。'))
  }, [open])

  function toggleRole(userId: number, role: UserRole) {
    setDrafts((current) => {
      const roles = current[userId] ?? []
      return {
        ...current,
        [userId]: roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role],
      }
    })
  }

  async function saveUser(userId: number) {
    const roles = drafts[userId] ?? []
    if (roles.length === 0) {
      setError('每个账号至少需要一个角色。')
      return
    }
    setBusyUserId(userId)
    setError('')
    try {
      const result = await updateManagedUserRoles(userId, roles)
      setUsers((current) => current.map((user) => user.id === userId ? { ...user, roles: result.roles } : user))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '角色保存失败。')
    } finally {
      setBusyUserId(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="role-management-dialog">
        <DialogHeader>
          <DialogTitle>用户与角色</DialogTitle>
          <DialogDescription>职业角色可以多选；组织管理员角色控制组织管理看板入口。</DialogDescription>
        </DialogHeader>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="role-management-list">
          {users.map((user) => (
            <article key={user.id}>
              <div className="role-managed-user"><strong>{user.displayName}</strong><small>{user.username}</small></div>
              <div className="role-checkboxes">
                {(Object.keys(userRoleLabel) as UserRole[]).map((role) => (
                  <label key={role}>
                    <input type="checkbox" checked={(drafts[user.id] ?? []).includes(role)} onChange={() => toggleRole(user.id, role)} />
                    {userRoleLabel[role]}
                  </label>
                ))}
              </div>
              <Button size="sm" variant="outline" disabled={busyUserId === user.id} onClick={() => void saveUser(user.id)}>
                {busyUserId === user.id ? '保存中...' : '保存'}
              </Button>
            </article>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ManageRolesMenuLabel() {
  return <><UsersThree /> 用户与角色</>
}
