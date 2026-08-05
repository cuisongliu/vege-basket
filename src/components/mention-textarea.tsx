import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Textarea } from '@/components/ui/textarea'

export type MentionMember = {
  id: number
  name: string
}

type MentionTextareaProps = Omit<ComponentProps<typeof Textarea>, 'onChange' | 'value'> & {
  members?: MentionMember[]
  onChange: (value: string) => void
  value: string
}

export function MentionTextarea({ members = [], onChange, value, ...props }: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const shellRef = useRef<HTMLSpanElement | null>(null)
  const [mentionRange, setMentionRange] = useState<{ start: number; query: string } | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 260 })

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

  const updateMenuPosition = useCallback(() => {
    const shell = shellRef.current
    if (!shell || typeof window === 'undefined') return
    const rect = shell.getBoundingClientRect()
    const width = Math.min(360, Math.max(260, rect.width))
    const estimatedHeight = filteredMembers.length * 46 + 12
    const margin = 8
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const top = spaceBelow >= estimatedHeight || rect.top < estimatedHeight + margin
      ? rect.bottom + 4
      : rect.top - estimatedHeight - 4
    setMenuPosition({
      left: Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - margin)),
      width,
    })
  }, [filteredMembers.length])

  useEffect(() => {
    if (!mentionRange || filteredMembers.length === 0) return
    updateMenuPosition()
    const handleViewportChange = () => updateMenuPosition()
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
    <span ref={shellRef} className="mention-input-shell mention-textarea-shell">
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
        typeof document === 'undefined' ? null : createPortal(
          <span
            className="mention-menu mention-menu-floating"
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: menuPosition.width,
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
          document.body,
        )
      ) : null}
    </span>
  )
}
