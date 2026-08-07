import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowClockwise, Check, CopySimple, LinkSimple } from '@phosphor-icons/react'
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
  const requestIdRef = useRef(0)

  const loadLink = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setBusy(true)
    setCopied(false)
    setError('')
    setLink('')
    try {
      const result = await createBugShareLink(bugId)
      if (requestIdRef.current !== requestId) return
      setLink(result.url)
    } catch (reason) {
      if (requestIdRef.current !== requestId) return
      const message = reason instanceof DOMException && reason.name === 'AbortError'
        ? '分享链接生成超时，请稍后重试。'
        : '分享链接生成失败，请稍后重试。'
      setError(message)
    } finally {
      if (requestIdRef.current === requestId) setBusy(false)
    }
  }, [bugId])

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1
      return
    }
    void loadLink()
    return () => {
      requestIdRef.current += 1
    }
  }, [loadLink, open])

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
        {link ? <div className="bug-share-link-box"><LinkSimple size={18} /><span>{link}</span></div> : <p className={error ? 'bug-share-error' : 'bug-share-loading'}>{error || '正在生成分享链接...'}</p>}
        <DialogFooter>
          <Button type="button" onClick={() => void (link ? copyLink() : loadLink())} disabled={busy}>
            {link ? (copied ? <Check /> : <CopySimple />) : <ArrowClockwise />}
            {link ? (copied ? '已复制' : '复制链接') : (busy ? '生成中...' : '重新生成')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
