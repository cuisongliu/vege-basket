import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchProjectLedgerMaintainers,
  saveProjectLedgerMaintainers,
} from '../api'
import type { ProjectLedgerMaintainerConfiguration } from '../../shared/project-ledger'
import { isUncertainActionError, reconcileAction } from '../confirmed-action'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import './project-ledger.css'

const unresolved = new Map<string, number[]>()
const signature = (members: number[]) => JSON.stringify([...members].sort((left, right) => left - right))

export function ProjectLedgerMaintainersPanel({ organizationId, projectId }: { organizationId: number; projectId: number }) {
  const identity = `${organizationId}:${projectId}`
  const [data, setData] = useState<ProjectLedgerMaintainerConfiguration | null>(null)
  const [draft, setDraft] = useState<number[]>([])
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(() => unresolved.has(identity))
  const locked = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let active = true
    setData(null)
    setError('')
    setEditing(false)
    setUncertain(unresolved.has(identity))
    fetchProjectLedgerMaintainers(organizationId, projectId)
      .then((next) => { if (active) setData(next) })
      .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : '台账维护人加载失败') })
    return () => { active = false }
  }, [organizationId, projectId, identity])

  const candidates = useMemo(() => data?.candidates.filter((candidate) => (
    candidate.projectMember && `${candidate.name} ${candidate.username}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  )) ?? [], [data, search])

  async function save(): Promise<boolean> {
    if (!data || locked.current || unresolved.has(identity)) return false
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const expected = data.members.map((member) => member.userId)
      const next = await reconcileAction(
        () => saveProjectLedgerMaintainers(organizationId, projectId, draft, expected),
        () => fetchProjectLedgerMaintainers(organizationId, projectId),
        result => signature(result.members.map((member) => member.userId)) === signature(draft),
      )
      if (!mounted.current) return false
      setData(next)
      setEditing(false)
      setSearch('')
      return true
    } catch (failure) {
      if (isUncertainActionError(failure)) unresolved.set(identity, [...draft])
      if (mounted.current) {
        setUncertain(unresolved.has(identity))
        setError(failure instanceof Error ? failure.message : '台账维护人保存失败')
      }
      throw failure
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function checkConfiguration() {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    try {
      const next = await fetchProjectLedgerMaintainers(organizationId, projectId)
      if (!mounted.current) return
      const pending = unresolved.get(identity)
      if (pending) {
        if (signature(next.members.map((member) => member.userId)) === signature(pending)) {
          unresolved.delete(identity)
          setUncertain(false)
          setData(next)
          setEditing(false)
          setSearch('')
          setError('')
        } else {
          setError('已读取当前配置，尚不能确认上次保存成功。请稍后再次核对，不会重复提交。')
        }
      } else {
        setData(next)
        setDraft(next.members.map((member) => member.userId))
        setError(editing ? '已读取最新配置，请重新核对维护人后保存。' : '')
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '核对失败，请稍后重试')
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const removed = data?.members.filter((member) => !draft.includes(member.userId)) ?? []
  const disabled = busy || uncertain || !data
    || signature(draft) === signature(data.members.map((member) => member.userId))

  return <section className="ledger-maintainers-panel" aria-label="项目台账维护人">
    <header><div><strong>台账维护人</strong><span>负责维护项目简介、集群、机器、版本与网络资料</span></div>
      {!editing ? <Button size="sm" variant="outline" disabled={!data || uncertain} onClick={() => { setDraft(data?.members.map((member) => member.userId) ?? []); setEditing(true); setError('') }}>配置</Button> : null}
    </header>
    {error ? <p role="alert">{error}</p> : null}
    {uncertain ? <p role="alert">保存结果尚未确认，请核对当前配置。未确认前不能再次保存。</p> : null}
    {!data && !error ? <p>正在加载维护人...</p> : null}
    {data && !editing ? <p>{data.members.map((member) => member.name).join('、') || '尚未配置'}</p> : null}
    {data && editing ? <div className="ledger-maintainer-editor">
      <Input aria-label="搜索台账维护人" placeholder="搜索项目开发成员" value={search} onChange={(event) => setSearch(event.target.value)} />
      <div>{candidates.map((candidate) => <label key={candidate.id}>
        <input type="checkbox" checked={draft.includes(candidate.id)} disabled={busy || uncertain} onChange={(event) => setDraft((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} />
        <span>{candidate.name}<small>{candidate.username}</small></span>
      </label>)}</div>
      <footer><Button variant="outline" disabled={busy || uncertain} onClick={() => { setEditing(false); setSearch('') }}>取消</Button>{removed.length ? <ConfirmActionDialog actionKey={`ledger-maintainers:${identity}:${signature(data.members.map((member) => member.userId))}`} title="确认调整台账维护人？" description={`将移除以下台账维护人：${removed.map((member) => member.name).join('、')}。移除后将立即失去台账编辑权限，历史维护记录保留。`} confirmLabel="保存配置" confirmDisabled={disabled} onConfirm={save} trigger={<Button disabled={disabled}>保存配置</Button>} /> : <Button disabled={disabled} onClick={() => { void save().catch(() => {}) }}>{busy ? '保存中...' : '保存配置'}</Button>}</footer>
    </div> : null}
    {(uncertain || error) ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void checkConfiguration()}>{uncertain ? '核对保存结果' : editing ? '读取最新配置' : '重新加载'}</Button> : null}
  </section>
}
