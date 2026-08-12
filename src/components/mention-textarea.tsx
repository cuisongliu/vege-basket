import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Textarea } from '@/components/ui/textarea'

export type MentionMember = {
  id: number
  name: string
}

const mentionMenuMaxHeight = 220

type MentionTextareaProps = Omit<ComponentProps<typeof Textarea>, 'onChange' | 'value'> & {
  members?: MentionMember[]
  menuClassName?: string
  menuPlacement?: 'above' | 'auto'
  onChange: (value: string) => void
  value: string
}

export function MentionTextarea({
  members = [],
  menuClassName = '',
  menuPlacement = 'auto',
  onChange,
  value,
  ...props
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const shellRef = useRef<HTMLSpanElement | null>(null)
  const [mentionRange, setMentionRange] = useState<{ start: number; query: string } | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 260 })
  const [menuPortalHost, setMenuPortalHost] = useState<HTMLElement | null>(null)

  const availableMembers = useMemo(() => {
    const seen = new Set<string>()
    return members.filter((member) => {
      const name = member.name.trim()
      if (!name || seen.has(name)) return false
      seen.add(name)
      return true
    })
  }, [members])

  const filteredMembers = useMemo(() => {
    if (!mentionRange) return []
    const query = mentionRange.query.toLocaleLowerCase()
    return availableMembers.filter((member) => member.name.toLocaleLowerCase().includes(query))
  }, [availableMembers, mentionRange])

  const setShellRef = useCallback((node: HTMLSpanElement | null) => {
    shellRef.current = node
    if (typeof document === 'undefined') {
      setMenuPortalHost(null)
      return
    }
    setMenuPortalHost(node?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? document.body)
  }, [])

  const updateMenuPosition = useCallback(() => {
    const shell = shellRef.current
    if (!shell || typeof window === 'undefined') return
    const rect = shell.getBoundingClientRect()
    const dialogContent = shell.closest<HTMLElement>('[data-slot="dialog-content"]')
    const containingRect = dialogContent?.getBoundingClientRect()
    const width = Math.min(360, Math.max(260, rect.width))
    const estimatedHeight = Math.min(filteredMembers.length * 46 + 12, mentionMenuMaxHeight)
    const margin = 8
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const showAbove = menuPlacement === 'above' || (
      spaceBelow < estimatedHeight && rect.top >= estimatedHeight + margin
    )
    const viewportLeft = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - width - margin),
    )
    const desiredTop = showAbove ? rect.top - estimatedHeight - 4 : rect.bottom + 4
    const viewportTop = Math.min(
      Math.max(margin, desiredTop),
      Math.max(margin, window.innerHeight - estimatedHeight - margin),
    )
    setMenuPosition({
      left: viewportLeft - (containingRect?.left ?? 0),
      top: viewportTop - (containingRect?.top ?? 0),
      width,
    })
  }, [filteredMembers.length, menuPlacement])

  useEffect(() => {
    if (!mentionRange || filteredMembers.length === 0) return
    updateMenuPosition()
    const handleViewportChange = (event: Event) => {
      // 菜单自身的滚动不改变锚点位置：跳过，避免滚动过程中反复 setState 触发重渲染
      if (event.target instanceof Element && event.target.closest('.mention-menu-floating')) return
      updateMenuPosition()
    }
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [filteredMembers.length, mentionRange, updateMenuPosition])

  function updateMentionRange(nextValue: string, caret: number) {
    const prefix = nextValue.slice(0, caret)
    const match = prefix.match(/(?:^|\s)@([^\s@]*)$/u)
    if (!match) {
      setMentionRange(null)
      return
    }
    const query = match[1] ?? ''
    setMentionRange({ start: caret - query.length - 1, query })
  }

  function chooseMember(member: MentionMember) {
    const range = mentionRange
    if (!range) return
    const textarea = textareaRef.current
    const caret = textarea?.selectionStart ?? value.length
    const nextValue = `${value.slice(0, range.start)}@${member.name} ${value.slice(caret)}`
    onChange(nextValue)
    setMentionRange(null)
    window.requestAnimationFrame(() => {
      const nextCaret = range.start + member.name.length + 2
      textarea?.focus()
      textarea?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  return (
    <span ref={setShellRef} className="mention-input-shell mention-textarea-shell">
      <Textarea
        {...props}
        ref={textareaRef}
        value={value}
        onBlur={() => window.setTimeout(() => setMentionRange(null), 120)}
        onChange={(event) => {
          const nextValue = event.target.value
          onChange(nextValue)
          updateMentionRange(nextValue, event.target.selectionStart ?? nextValue.length)
        }}
        onKeyUp={(event) => updateMentionRange(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
      />
      {mentionRange && filteredMembers.length > 0 ? (
        menuPortalHost == null ? null : createPortal(
          <span
            className={['mention-menu', 'mention-menu-floating', menuClassName].filter(Boolean).join(' ')}
            style={{
              left: menuPosition.left,
              position: menuPortalHost === document.body ? 'fixed' : 'absolute',
              top: menuPosition.top,
              width: menuPosition.width,
              // 内联兜底：即使样式表加载异常/被覆盖，菜单仍是 220px 可滚动盒子
              maxHeight: mentionMenuMaxHeight,
              overflowY: 'auto',
            } satisfies CSSProperties}
          >
            {filteredMembers.map((member) => (
              <button
                className="mention-option"
                key={member.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  chooseMember(member)
                }}
              >
                <strong>@{member.name}</strong>
                <small>组织成员</small>
              </button>
            ))}
          </span>,
          menuPortalHost,
        )
      ) : null}
    </span>
  )
}
