import { useCallback, useEffect, useState } from 'react'
import { Check, CopySimple, LinkSimple } from '@phosphor-icons/react'
import { createBugShareLink } from '../bug-share-api'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

export function BugShareDialog({ bugId, open, onOpenChange }: {
  bugId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const loadLink = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const result = await createBugShareLink(bugId)
      setLink(result.url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分享链接生成失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }, [bugId])

  useEffect(() => {
    if (!open || link || busy) return
    void loadLink()
  }, [busy, link, loadLink, open])

  async function copyLink() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>分享 Bug</DialogTitle>
          <DialogDescription>复制链接后可分享到飞书或其他协作工具。打开链接无需登录，评论需要登录。</DialogDescription>
        </DialogHeader>
        {error ? <p className="bug-share-error">{error}</p> : null}
        {link ? <div className="bug-share-link-box"><LinkSimple size={18} /><span>{link}</span></div> : <p className="bug-share-loading">{busy ? '正在生成分享链接...' : '分享链接尚未生成。'}</p>}
        <DialogFooter>
          <Button type="button" onClick={() => void copyLink()} disabled={!link || busy}>{copied ? <Check /> : <CopySimple />} {copied ? '已复制' : '复制链接'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
