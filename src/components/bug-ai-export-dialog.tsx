import { CheckCircle, Sparkle, WarningCircle, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { shouldGenerateAiBugImagePrompt } from '../ai-export-prompt'
import type { AiBugExportImage, AiBugExportImagePromptResult } from '../test-workbench-types'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Textarea } from './ui/textarea'

type ImageStatus = 'idle' | 'generating' | 'generated' | 'manual' | 'failed' | 'skipped'

export function BugAiExportDialog({
  busy,
  error,
  images,
  onContinue,
  onGenerate,
  onOpenChange,
  open,
}: {
  busy: boolean
  error?: string
  images: AiBugExportImage[]
  onContinue: (prompts: Array<{ imageId: string; label: string; prompt: string }>) => void
  onGenerate: (images: Array<{ imageId: string; instruction: string }>) => Promise<AiBugExportImagePromptResult[]>
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [instructions, setInstructions] = useState<Record<string, string>>({})
  const [statuses, setStatuses] = useState<Record<string, ImageStatus>>({})
  const [previewImage, setPreviewImage] = useState<AiBugExportImage | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setPrompts({})
    setInstructions({})
    setStatuses(Object.fromEntries(images.map((image) => [image.id, 'idle'])))
    setPreviewImage(null)
  }, [images, open])

  const selectedImages = useMemo(() => images.filter((image) => selected.has(image.id)), [images, selected])
  const generatableImages = selectedImages.filter((image) => shouldGenerateAiBugImagePrompt(
    prompts[image.id] ?? '',
    statuses[image.id] === 'skipped',
  ))
  const ready = selectedImages.every((image) => statuses[image.id] === 'skipped' || Boolean(prompts[image.id]?.trim()))
  const toggleSelected = (image: AiBugExportImage, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(image.id)
      else next.delete(image.id)
      return next
    })
    if (!checked) setStatuses((current) => ({ ...current, [image.id]: 'idle' }))
  }

  async function generateSelected() {
    if (!generatableImages.length) return
    setStatuses((current) => {
      const next = { ...current }
      for (const image of generatableImages) next[image.id] = 'generating'
      return next
    })
    const results = await onGenerate(generatableImages.map((image) => ({ imageId: image.id, instruction: instructions[image.id] ?? '' })))
    setPrompts((current) => {
      const next = { ...current }
      for (const result of results) if (result.prompt) next[result.imageId] = result.prompt
      return next
    })
    setStatuses((current) => {
      const next = { ...current }
      for (const result of results) next[result.imageId] = result.prompt ? 'generated' : 'failed'
      return next
    })
  }

  function updatePrompt(imageId: string, prompt: string) {
    setPrompts((current) => ({ ...current, [imageId]: prompt }))
    setStatuses((current) => ({ ...current, [imageId]: prompt.trim() ? 'manual' : 'idle' }))
  }

  function continueToPreview() {
    onContinue(selectedImages
      .filter((image) => statuses[image.id] !== 'skipped' && prompts[image.id]?.trim())
      .map((image) => ({ imageId: image.id, label: image.label, prompt: prompts[image.id]!.trim() })))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bug-ai-export-dialog">
        <DialogHeader>
          <DialogTitle>准备 Bug 图片证据</DialogTitle>
          <DialogDescription>手动填写的内容会直接作为图片证据，不再调用 AI；留空图片可并发识别。</DialogDescription>
        </DialogHeader>
        {error ? <p className="test-form-error" role="alert">{error}</p> : null}
        <div className="bug-ai-export-toolbar">
          <span>{selectedImages.length} / {images.length} 张图片已选择</span>
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelected(new Set(images.map((image) => image.id)))} disabled={!images.length || busy}>全选</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={!selectedImages.length || busy}>清空</Button>
            <Button type="button" size="sm" disabled={busy || !generatableImages.length} onClick={() => void generateSelected()}><Sparkle /> AI 并发识别</Button>
          </div>
        </div>
        {images.length ? <div className="bug-ai-export-image-list">
          {images.map((image) => {
            const status = statuses[image.id] ?? 'idle'
            return <article className="bug-ai-export-image-item" key={image.id}>
              <div className="bug-ai-export-image-heading">
                <Checkbox checked={selected.has(image.id)} onCheckedChange={(checked) => toggleSelected(image, checked === true)} aria-label={`选择${image.label}`} />
                <button
                  aria-label={`预览${image.label}`}
                  className="bug-ai-export-image-preview-trigger"
                  title="预览图片"
                  type="button"
                  onClick={() => setPreviewImage(image)}
                >
                  <img src={image.previewUrl} alt="" loading="lazy" />
                </button>
                <div><strong>{image.label}</strong><small>{image.fileSize ? `${Math.ceil(image.fileSize / 1024)} KB` : '附件图片'}</small></div>
                <span className={`bug-ai-export-image-status ${status}`}>
                  {status === 'generating' ? '生成中' : status === 'generated' ? 'AI 已生成' : status === 'manual' ? '已手动填写' : status === 'failed' ? '生成失败' : status === 'skipped' ? '已跳过' : '未处理'}
                </span>
              </div>
              {selected.has(image.id) ? <>
                <Textarea
                  aria-label={`${image.label} 的图片证据`}
                  disabled={busy}
                  placeholder="直接填写图片中的关键事实。填写后将直接使用，不再调用 AI。"
                  value={prompts[image.id] ?? ''}
                  onChange={(event) => updatePrompt(image.id, event.target.value)}
                />
                <div className="bug-ai-export-image-actions">
                  <label>
                    <span>AI 识别重点<small>仅图片证据为空时使用</small></span>
                    <InputLike
                      disabled={busy || Boolean(prompts[image.id]?.trim())}
                      value={instructions[image.id] ?? ''}
                      onChange={(value) => setInstructions((current) => ({ ...current, [image.id]: value }))}
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setStatuses((current) => ({
                      ...current,
                      [image.id]: status === 'skipped' ? (prompts[image.id]?.trim() ? 'manual' : 'idle') : 'skipped',
                    }))}
                  >{status === 'skipped' ? '恢复' : '跳过'}</Button>
                  {status === 'failed' ? <WarningCircle aria-label="生成失败" /> : null}
                </div>
              </> : null}
            </article>
          })}
        </div> : <div className="bug-ai-export-empty">当前 Bug 没有可解析的图片，可以直接导出文字提示词。</div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={busy || (images.length > 0 && (!selectedImages.length || !ready))} onClick={continueToPreview}><CheckCircle />进入提示词预览</Button>
        </DialogFooter>
      </DialogContent>
      <Dialog open={Boolean(previewImage)} onOpenChange={(previewOpen) => { if (!previewOpen) setPreviewImage(null) }}>
        <DialogContent className="bug-share-image-preview-dialog" showCloseButton={false}>
          <DialogTitle className="bug-share-image-preview-title">{previewImage?.label ?? '图片'}预览</DialogTitle>
          {previewImage ? <div className="bug-share-image-preview-shell">
            <img className="bug-share-image-preview" src={previewImage.previewUrl} alt={`${previewImage.label}预览`} />
            <button aria-label="关闭图片预览" className="bug-share-image-preview-close" type="button" onClick={() => setPreviewImage(null)}><X size={18} /></button>
          </div> : null}
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

function InputLike({ disabled, value, onChange }: { disabled: boolean; value: string; onChange: (value: string) => void }) {
  return <input aria-label="AI 识别重点" className="bug-ai-export-instruction" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} placeholder="例如：重点识别错误码和异常状态" />
}
