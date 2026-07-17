import {
  ArrowLeft,
  Bell,
  CaretRight,
  LinkSimple,
  LockKey,
  UserCircle,
} from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'

import {
  createFeishuOAuthUrl,
  fetchNotificationSubscription,
  updateCurrentPassword,
  updateNotificationSubscription,
  type AuthUser,
} from '@/api'
import type { NotificationSubscription } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

type AccountSettingsView = 'overview' | 'profile' | 'notifications' | 'security'
type AccountSettingsDetailView = Exclude<AccountSettingsView, 'overview'>
type MutationToken = {
  generation: number
  id: number
}

export type AccountSettingsDialogProps = {
  open: boolean
  user: AuthUser | null
  onDisconnectFeishu: () => Promise<AuthUser>
  onOpenChange: (open: boolean) => void
  onSaveProfile: (payload: { displayName: string }) => Promise<void>
  returnFocusRef?: RefObject<HTMLElement | null>
}

const defaultSubscription: NotificationSubscription = {
  enabled: false,
  localSendTime: '10:00',
  timezone: 'Asia/Shanghai',
}

function getDisplayName(user: AuthUser | null) {
  if (!user) return 'Veges'
  return user.displayName || user.username
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function AccountSettingsDialog({
  open,
  user,
  onDisconnectFeishu,
  onOpenChange,
  onSaveProfile,
  returnFocusRef,
}: AccountSettingsDialogProps) {
  const [view, setView] = useState<AccountSettingsView>('overview')
  const [lastSavedView, setLastSavedView] = useState<AccountSettingsDetailView | null>(null)
  const [savedDisplayName, setSavedDisplayName] = useState<string | null>(null)
  const [feishuDisconnected, setFeishuDisconnected] = useState(false)

  const [profileDraft, setProfileDraft] = useState(getDisplayName(user))
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')

  const [feishuBusy, setFeishuBusy] = useState(false)
  const [feishuError, setFeishuError] = useState('')
  const [feishuSuccess, setFeishuSuccess] = useState('')

  const [persistedSubscription, setPersistedSubscription] =
    useState<NotificationSubscription>(defaultSubscription)
  const [subscriptionDraft, setSubscriptionDraft] =
    useState<NotificationSubscription>(defaultSubscription)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionLoadError, setSubscriptionLoadError] = useState('')
  const [subscriptionSaving, setSubscriptionSaving] = useState(false)
  const [subscriptionSaveError, setSubscriptionSaveError] = useState('')

  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('')
  const [nextPasswordDraft, setNextPasswordDraft] = useState('')
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  const wasOpenRef = useRef(false)
  const openGenerationRef = useRef(0)
  const nextMutationIdRef = useRef(0)
  const activeMutationIdRef = useRef<number | null>(null)
  const subscriptionRequestIdRef = useRef(0)
  const profileOverviewButtonRef = useRef<HTMLButtonElement>(null)
  const notificationOverviewButtonRef = useRef<HTMLButtonElement>(null)
  const securityOverviewButtonRef = useRef<HTMLButtonElement>(null)
  const notificationPrimaryActionRef = useRef<HTMLButtonElement>(null)

  const displayName = savedDisplayName ?? getDisplayName(user)
  const feishuLinked = !feishuDisconnected && Boolean(user?.feishuLinked)
  const feishuEmail = feishuDisconnected ? '' : user?.feishuEmail ?? ''
  const profileChanged = profileDraft.trim() !== displayName.trim()
  const subscriptionChanged =
    subscriptionDraft.enabled !== persistedSubscription.enabled ||
    subscriptionDraft.localSendTime !== persistedSubscription.localSendTime
  const notificationMutationBusy = feishuBusy || subscriptionSaving

  const loadSubscription = useCallback(async () => {
    const requestId = subscriptionRequestIdRef.current + 1
    subscriptionRequestIdRef.current = requestId
    setSubscriptionLoading(true)
    setSubscriptionLoadError('')
    try {
      const result = await fetchNotificationSubscription()
      if (subscriptionRequestIdRef.current === requestId) {
        setPersistedSubscription(result.subscription)
        setSubscriptionDraft(result.subscription)
      }
    } catch (error) {
      if (subscriptionRequestIdRef.current === requestId) {
        setSubscriptionLoadError(
          getErrorMessage(error, '无法读取每日推送设置，请稍后重试。'),
        )
      }
    } finally {
      if (subscriptionRequestIdRef.current === requestId) {
        setSubscriptionLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      openGenerationRef.current += 1
      activeMutationIdRef.current = null
      setView('overview')
      setLastSavedView(null)
      setSavedDisplayName(null)
      setFeishuDisconnected(false)
      setProfileDraft(getDisplayName(user))
      setProfileBusy(false)
      setProfileError('')
      setFeishuBusy(false)
      setFeishuError('')
      setFeishuSuccess('')
      setPersistedSubscription(defaultSubscription)
      setSubscriptionDraft(defaultSubscription)
      setSubscriptionSaveError('')
      setSubscriptionSaving(false)
      setPasswordError('')
      setPasswordBusy(false)
      setCurrentPasswordDraft('')
      setNextPasswordDraft('')
      setConfirmPasswordDraft('')
      void loadSubscription()
    }

    if (!open && wasOpenRef.current) {
      openGenerationRef.current += 1
      activeMutationIdRef.current = null
      subscriptionRequestIdRef.current += 1
      setView('overview')
      setLastSavedView(null)
      setProfileError('')
      setProfileBusy(false)
      setFeishuError('')
      setFeishuSuccess('')
      setFeishuBusy(false)
      setSubscriptionLoadError('')
      setSubscriptionSaveError('')
      setSubscriptionLoading(false)
      setSubscriptionSaving(false)
      setCurrentPasswordDraft('')
      setNextPasswordDraft('')
      setConfirmPasswordDraft('')
      setPasswordError('')
      setPasswordBusy(false)
    }

    wasOpenRef.current = open
  }, [loadSubscription, open, user])

  useEffect(() => {
    if (!lastSavedView) return
    const timeoutId = window.setTimeout(() => setLastSavedView(null), 2400)
    return () => window.clearTimeout(timeoutId)
  }, [lastSavedView])

  function beginMutation(): MutationToken | null {
    if (activeMutationIdRef.current !== null) return null
    const id = nextMutationIdRef.current + 1
    nextMutationIdRef.current = id
    activeMutationIdRef.current = id
    return { generation: openGenerationRef.current, id }
  }

  function isMutationCurrent(token: MutationToken) {
    return (
      activeMutationIdRef.current === token.id &&
      openGenerationRef.current === token.generation
    )
  }

  function finishMutation(token: MutationToken) {
    if (activeMutationIdRef.current === token.id) {
      activeMutationIdRef.current = null
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && activeMutationIdRef.current !== null) return
    onOpenChange(nextOpen)
  }

  function focusOverviewRow(detailView: AccountSettingsDetailView) {
    if (detailView === 'profile') profileOverviewButtonRef.current?.focus()
    if (detailView === 'notifications') notificationOverviewButtonRef.current?.focus()
    if (detailView === 'security') securityOverviewButtonRef.current?.focus()
  }

  function returnToOverview(
    detailView: AccountSettingsDetailView,
    discardNotificationDraft = true,
  ) {
    if (detailView === 'notifications' && discardNotificationDraft) {
      setSubscriptionDraft(persistedSubscription)
      setSubscriptionSaveError('')
    }
    setView('overview')
    window.requestAnimationFrame(() => focusOverviewRow(detailView))
  }

  function openDetail(detailView: AccountSettingsDetailView) {
    setLastSavedView(null)
    if (detailView === 'profile') {
      setProfileDraft(displayName)
      setProfileError('')
    }
    if (detailView === 'notifications') {
      setFeishuError('')
      setFeishuSuccess('')
      setSubscriptionDraft(persistedSubscription)
      setSubscriptionSaveError('')
    }
    if (detailView === 'security') {
      setCurrentPasswordDraft('')
      setNextPasswordDraft('')
      setConfirmPasswordDraft('')
      setPasswordError('')
    }
    setView(detailView)
    if (detailView === 'notifications') {
      window.requestAnimationFrame(() => notificationPrimaryActionRef.current?.focus())
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const displayNameValue = profileDraft.trim()
    if (!displayNameValue) {
      setProfileError('昵称不能为空。')
      return
    }

    const mutation = beginMutation()
    if (!mutation) return

    setProfileBusy(true)
    setProfileError('')
    try {
      await onSaveProfile({ displayName: displayNameValue })
      if (!isMutationCurrent(mutation)) return
      setSavedDisplayName(displayNameValue)
      setProfileDraft(displayNameValue)
      setLastSavedView('profile')
      returnToOverview('profile')
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setProfileError(getErrorMessage(error, '保存失败，请稍后重试。'))
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setProfileBusy(false)
    }
  }

  async function bindFeishuAccount() {
    const mutation = beginMutation()
    if (!mutation) return

    setFeishuBusy(true)
    setFeishuError('')
    setFeishuSuccess('')
    try {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const result = await createFeishuOAuthUrl({ returnTo })
      if (!isMutationCurrent(mutation)) return
      window.location.assign(result.url)
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setFeishuError(getErrorMessage(error, '飞书授权链接生成失败，请稍后重试。'))
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setFeishuBusy(false)
    }
  }

  async function disconnectFeishu() {
    const mutation = beginMutation()
    if (!mutation) return

    setFeishuBusy(true)
    setFeishuError('')
    setFeishuSuccess('')
    try {
      const result = await onDisconnectFeishu()
      if (!isMutationCurrent(mutation)) return
      subscriptionRequestIdRef.current += 1
      setFeishuDisconnected(true)
      setSavedDisplayName(result.displayName || result.username)
      setPersistedSubscription((current) => ({ ...current, enabled: false }))
      setSubscriptionDraft((current) => ({ ...current, enabled: false }))
      setSubscriptionLoading(false)
      setSubscriptionSaveError('')
      setFeishuSuccess('飞书账号已解除绑定。')
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setFeishuError(getErrorMessage(error, '解除飞书绑定失败，请稍后重试。'))
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setFeishuBusy(false)
    }
  }

  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(subscriptionDraft.localSendTime)) {
      setSubscriptionSaveError('请输入有效的 24 小时时间。')
      return
    }
    if (subscriptionDraft.enabled && !feishuLinked) {
      setSubscriptionSaveError('请先绑定飞书账号，再开启每日推送。')
      return
    }

    const mutation = beginMutation()
    if (!mutation) return

    setSubscriptionSaving(true)
    setSubscriptionSaveError('')
    try {
      const result = await updateNotificationSubscription({
        enabled: subscriptionDraft.enabled,
        localSendTime: subscriptionDraft.localSendTime,
      })
      if (!isMutationCurrent(mutation)) return
      setPersistedSubscription(result.subscription)
      setSubscriptionDraft(result.subscription)
      setLastSavedView('notifications')
      returnToOverview('notifications', false)
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setSubscriptionSaveError(
          getErrorMessage(error, '每日推送设置保存失败，请稍后重试。'),
        )
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setSubscriptionSaving(false)
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentPasswordDraft || nextPasswordDraft.length < 6) {
      setPasswordError('请输入旧密码，并确保新密码不少于 6 位。')
      return
    }
    if (nextPasswordDraft !== confirmPasswordDraft) {
      setPasswordError('两次输入的新密码不一致。')
      return
    }

    const mutation = beginMutation()
    if (!mutation) return

    setPasswordBusy(true)
    setPasswordError('')
    try {
      await updateCurrentPassword({
        currentPassword: currentPasswordDraft,
        nextPassword: nextPasswordDraft,
      })
      if (!isMutationCurrent(mutation)) return
      setCurrentPasswordDraft('')
      setNextPasswordDraft('')
      setConfirmPasswordDraft('')
      setLastSavedView('security')
      returnToOverview('security')
    } catch (error) {
      if (isMutationCurrent(mutation)) {
        setPasswordError(getErrorMessage(error, '修改失败，请确认旧密码是否正确。'))
      }
    } finally {
      const isCurrent = isMutationCurrent(mutation)
      finishMutation(mutation)
      if (isCurrent) setPasswordBusy(false)
    }
  }

  function renderDetailHeader(
    detailView: AccountSettingsDetailView,
    title: string,
    description: string,
    busy: boolean,
  ) {
    return (
      <DialogHeader className="account-settings-detail-header">
        <Button
          aria-label="返回账户设置概览"
          className="account-settings-back-button"
          disabled={busy}
          size="icon"
          title="返回"
          type="button"
          variant="ghost"
          onClick={() => returnToOverview(detailView)}
        >
          <ArrowLeft size={18} />
        </Button>
        <div className="account-settings-detail-heading">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </DialogHeader>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`account-settings-dialog is-${view}`}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        {view === 'overview' ? (
          <>
            <DialogHeader>
              <DialogTitle>账户设置</DialogTitle>
              <DialogDescription>
                {user?.username ? `${user.username} · 当前登录账号` : '当前账户尚未登录'}
              </DialogDescription>
            </DialogHeader>
            <div className="account-settings-overview" aria-label="账户设置分类">
              <Button
                ref={profileOverviewButtonRef}
                className="account-settings-overview-row"
                type="button"
                variant="ghost"
                onClick={() => openDetail('profile')}
              >
                <span className="account-settings-overview-icon" aria-hidden="true">
                  <UserCircle size={20} weight="duotone" />
                </span>
                <span className="account-settings-overview-copy">
                  <strong>个人资料</strong>
                  <small>昵称：{displayName}</small>
                </span>
                {lastSavedView === 'profile' ? (
                  <span className="account-settings-overview-saved" aria-live="polite">
                    已保存
                  </span>
                ) : null}
                <CaretRight
                  aria-hidden="true"
                  className="account-settings-overview-caret"
                  size={16}
                  weight="bold"
                />
              </Button>
              <Separator />
              <Button
                ref={notificationOverviewButtonRef}
                className="account-settings-overview-row"
                type="button"
                variant="ghost"
                onClick={() => openDetail('notifications')}
              >
                <span className="account-settings-overview-icon" aria-hidden="true">
                  <Bell size={20} weight="duotone" />
                </span>
                <span className="account-settings-overview-copy">
                  <strong>飞书通知</strong>
                  <small>
                    飞书{feishuLinked ? '已绑定' : '未绑定'} · 每日推送
                    {subscriptionLoading
                      ? '读取中'
                      : subscriptionLoadError
                        ? '暂不可用'
                        : persistedSubscription.enabled
                          ? '已开启'
                          : '已关闭'}
                  </small>
                </span>
                {lastSavedView === 'notifications' ? (
                  <span className="account-settings-overview-saved" aria-live="polite">
                    已保存
                  </span>
                ) : null}
                <CaretRight
                  aria-hidden="true"
                  className="account-settings-overview-caret"
                  size={16}
                  weight="bold"
                />
              </Button>
              <Separator />
              <Button
                ref={securityOverviewButtonRef}
                className="account-settings-overview-row"
                type="button"
                variant="ghost"
                onClick={() => openDetail('security')}
              >
                <span className="account-settings-overview-icon" aria-hidden="true">
                  <LockKey size={20} weight="duotone" />
                </span>
                <span className="account-settings-overview-copy">
                  <strong>登录安全</strong>
                  <small>修改当前账户的登录密码</small>
                </span>
                {lastSavedView === 'security' ? (
                  <span className="account-settings-overview-saved" aria-live="polite">
                    已更新
                  </span>
                ) : null}
                <CaretRight
                  aria-hidden="true"
                  className="account-settings-overview-caret"
                  size={16}
                  weight="bold"
                />
              </Button>
            </div>
          </>
        ) : null}

        {view === 'profile' ? (
          <>
            {renderDetailHeader(
              'profile',
              '个人资料',
              user?.username ? `当前登录账号：${user.username}` : '维护当前账户的显示昵称。',
              profileBusy,
            )}
            <form className="account-settings-detail-form" onSubmit={saveProfile}>
              <div className="account-settings-detail-body">
                <Label>
                  昵称
                  <Input
                    autoFocus
                    aria-describedby={profileError ? 'account-settings-profile-error' : undefined}
                    aria-invalid={Boolean(profileError)}
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={profileBusy}
                    maxLength={32}
                    name="veges-account-display-name"
                    required
                    spellCheck={false}
                    value={profileDraft}
                    onChange={(event) => {
                      setProfileDraft(event.target.value)
                      setProfileError('')
                    }}
                  />
                </Label>
                {profileError ? (
                  <p className="form-error" id="account-settings-profile-error" role="alert">
                    {profileError}
                  </p>
                ) : null}
              </div>
              <DialogFooter className="account-settings-detail-actions">
                <Button
                  aria-busy={profileBusy}
                  disabled={profileBusy || !profileDraft.trim() || !profileChanged}
                  type="submit"
                >
                  {profileBusy ? '保存中...' : '保存资料'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}

        {view === 'notifications' ? (
          <>
            {renderDetailHeader(
              'notifications',
              '飞书通知',
              '管理飞书绑定和每日待办推送。',
              notificationMutationBusy,
            )}
            <form
              className="account-settings-detail-form account-settings-notification-form"
              onSubmit={saveSubscription}
            >
              <div className="account-settings-detail-body account-settings-notification-body">
                <section
                  className="account-settings-notification-section"
                  aria-labelledby="account-settings-feishu-title"
                >
                  <div className="account-settings-notification-heading">
                    <div>
                      <strong id="account-settings-feishu-title">飞书账号</strong>
                      <small>
                        {feishuLinked
                          ? feishuEmail || '已绑定，可接收个人通知和群内 @。'
                          : '未绑定，绑定后可接收个人通知和群内 @。'}
                      </small>
                    </div>
                    <div className="account-settings-notification-actions">
                      <Button
                        ref={notificationPrimaryActionRef}
                        aria-busy={notificationMutationBusy}
                        disabled={notificationMutationBusy || !user}
                        type="button"
                        variant={feishuLinked ? 'outline' : 'default'}
                        onClick={() => void bindFeishuAccount()}
                      >
                        <LinkSimple size={16} />
                        {feishuBusy ? '处理中...' : feishuLinked ? '重新绑定' : '绑定飞书'}
                      </Button>
                      {feishuLinked ? (
                        <Button
                          aria-busy={notificationMutationBusy}
                          disabled={notificationMutationBusy}
                          type="button"
                          variant="destructive"
                          onClick={() => void disconnectFeishu()}
                        >
                          解除绑定
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {feishuError ? (
                    <p className="form-error" role="alert">
                      {feishuError}
                    </p>
                  ) : null}
                  {feishuSuccess ? (
                    <p className="form-success" role="status" aria-live="polite">
                      {feishuSuccess}
                    </p>
                  ) : null}
                </section>
                <Separator />
                <section
                  className="account-settings-notification-section"
                  aria-labelledby="account-settings-digest-title"
                >
                  <div className="account-settings-notification-heading">
                    <div>
                      <strong id="account-settings-digest-title">每日待办完成推送</strong>
                      <small>每天发送上一完整自然日的完成情况。</small>
                    </div>
                    {!subscriptionLoading && !subscriptionLoadError ? (
                      <label className="account-settings-notification-toggle">
                        <input
                          aria-describedby={
                            subscriptionSaveError
                              ? 'account-settings-subscription-error'
                              : undefined
                          }
                          aria-invalid={Boolean(subscriptionSaveError)}
                          aria-labelledby="account-settings-digest-title account-settings-digest-toggle-state"
                          checked={subscriptionDraft.enabled}
                          disabled={
                            notificationMutationBusy ||
                            (!feishuLinked && !subscriptionDraft.enabled)
                          }
                          type="checkbox"
                          onChange={(event) => {
                            setSubscriptionDraft((current) => ({
                              ...current,
                              enabled: event.target.checked,
                            }))
                            setSubscriptionSaveError('')
                          }}
                        />
                        <span aria-hidden="true" />
                        <small id="account-settings-digest-toggle-state">
                          {subscriptionDraft.enabled ? '已开启' : '已关闭'}
                        </small>
                      </label>
                    ) : null}
                  </div>

                  {subscriptionLoading ? (
                    <p className="account-settings-inline-status" role="status">
                      正在读取推送设置...
                    </p>
                  ) : null}

                  {!subscriptionLoading && subscriptionLoadError ? (
                    <div className="account-settings-load-error">
                      <p className="form-error" role="alert">
                        {subscriptionLoadError}
                      </p>
                      <Button
                        disabled={notificationMutationBusy}
                        type="button"
                        variant="outline"
                        onClick={() => void loadSubscription()}
                      >
                        重新读取
                      </Button>
                    </div>
                  ) : null}

                  {!subscriptionLoading && !subscriptionLoadError ? (
                    <>
                    {subscriptionDraft.enabled ? (
                      <div className="account-settings-notification-time">
                        <Label>
                          推送时间
                          <Input
                            aria-describedby={
                              subscriptionSaveError
                                ? 'account-settings-subscription-error'
                                : undefined
                            }
                            aria-invalid={Boolean(subscriptionSaveError)}
                            disabled={notificationMutationBusy || !feishuLinked}
                            required
                            type="time"
                            value={subscriptionDraft.localSendTime}
                            onChange={(event) => {
                              setSubscriptionDraft((current) => ({
                                ...current,
                                localSendTime: event.target.value,
                              }))
                              setSubscriptionSaveError('')
                            }}
                          />
                        </Label>
                        <span className="account-settings-notification-timezone">
                          {subscriptionDraft.timezone || 'Asia/Shanghai'}
                        </span>
                      </div>
                    ) : null}
                    {!feishuLinked ? (
                      <p className="account-settings-notification-note">
                        绑定飞书账号后才能开启个人推送。
                      </p>
                    ) : null}
                    {subscriptionSaveError ? (
                      <p
                        className="form-error"
                        id="account-settings-subscription-error"
                        role="alert"
                      >
                        {subscriptionSaveError}
                      </p>
                    ) : null}
                    </>
                  ) : null}
                </section>
              </div>
              {!subscriptionLoading && !subscriptionLoadError ? (
                <DialogFooter className="account-settings-detail-actions">
                  <Button
                    aria-busy={notificationMutationBusy}
                    disabled={
                      notificationMutationBusy ||
                      !subscriptionChanged ||
                      (subscriptionDraft.enabled && !feishuLinked)
                    }
                    type="submit"
                  >
                    {subscriptionSaving ? '保存中...' : '保存通知设置'}
                  </Button>
                </DialogFooter>
              ) : null}
            </form>
          </>
        ) : null}

        {view === 'security' ? (
          <>
            {renderDetailHeader('security', '登录安全', '修改当前账户的登录密码。', passwordBusy)}
            <form
              autoComplete="off"
              className="account-settings-detail-form"
              data-1p-ignore="true"
              data-lpignore="true"
              data-protonpass-ignore="true"
              onSubmit={savePassword}
            >
              <div aria-hidden="true" className="autofill-decoys">
                <input autoComplete="username" name="username" tabIndex={-1} type="text" />
                <input autoComplete="current-password" name="password" tabIndex={-1} type="password" />
                <input autoComplete="new-password" name="new-password" tabIndex={-1} type="password" />
              </div>
              <div className="account-settings-detail-body account-settings-security-fields">
                <Label>
                  旧密码
                  <Input
                    autoFocus
                    aria-describedby={passwordError ? 'account-settings-password-error' : undefined}
                    aria-invalid={Boolean(passwordError)}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={passwordBusy}
                    name="veges-account-current-secret"
                    required
                    type="password"
                    value={currentPasswordDraft}
                    onChange={(event) => {
                      setCurrentPasswordDraft(event.target.value)
                      setPasswordError('')
                    }}
                  />
                </Label>
                <Label>
                  新密码
                  <Input
                    aria-describedby={passwordError ? 'account-settings-password-error' : undefined}
                    aria-invalid={Boolean(passwordError)}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={passwordBusy}
                    minLength={6}
                    name="veges-account-next-secret"
                    required
                    type="password"
                    value={nextPasswordDraft}
                    onChange={(event) => {
                      setNextPasswordDraft(event.target.value)
                      setPasswordError('')
                    }}
                  />
                </Label>
                <Label>
                  确认新密码
                  <Input
                    aria-describedby={passwordError ? 'account-settings-password-error' : undefined}
                    aria-invalid={Boolean(passwordError)}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-protonpass-ignore="true"
                    disabled={passwordBusy}
                    minLength={6}
                    name="veges-account-confirm-secret"
                    required
                    type="password"
                    value={confirmPasswordDraft}
                    onChange={(event) => {
                      setConfirmPasswordDraft(event.target.value)
                      setPasswordError('')
                    }}
                  />
                </Label>
                {passwordError ? (
                  <p className="form-error" id="account-settings-password-error" role="alert">
                    {passwordError}
                  </p>
                ) : null}
              </div>
              <DialogFooter className="account-settings-detail-actions">
                <Button aria-busy={passwordBusy} disabled={passwordBusy} type="submit">
                  {passwordBusy ? '修改中...' : '修改密码'}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
