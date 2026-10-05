import { CopySimple, DownloadSimple } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { downloadMarkdownFile } from '../ai-export-prompt'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

type AiExportPromptDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  prompt: string
  fileName: string
  summary?: string
}

export function AiExportPromptDialog({
  open,
  onOpenChange,
  title,
  description = '请确认以下数据范围。提示词只包含当前账号有权限读取的结构化文本数据。',
  prompt,
  fileName,
  summary,
}: AiExportPromptDialogProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [draftPrompt, setDraftPrompt] = useState(prompt)

  useEffect(() => {
    if (open) {
      setDraftPrompt(prompt)
      setCopyState('idle')
    }
  }, [open, prompt])

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(draftPrompt)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ai-export-prompt-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {summary ? <div className="ai-export-prompt-summary">{summary}</div> : null}
        <textarea className="ai-export-prompt-preview" value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} aria-label="导出提示词预览，可编辑" />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" variant="outline" onClick={() => void copyPrompt()}>
            <CopySimple size={16} /> {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制提示词'}
          </Button>
          <Button type="button" onClick={() => downloadMarkdownFile(fileName, draftPrompt)}>
            <DownloadSimple size={16} /> 下载 Markdown
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
