import type { ReactNode } from 'react'
import {
  isMarkdownSectionLine,
  normalizeMarkdownLinkLineBreaks,
} from '../markdown-preview-policy'

export function MarkdownPreview({
  compact = false,
  content,
}: {
  compact?: boolean
  content: string
}) {
  const lines = normalizeMarkdownLinkLineBreaks(content).split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let nextOrderedListStart = 1
  let canContinueOrderedList = false

  function resetOrderedListSequence() {
    nextOrderedListStart = 1
    canContinueOrderedList = false
  }

  function parseTableCells(text: string) {
    if (!text.startsWith('|') || !text.endsWith('|')) return null
    const cells = text
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
    return cells.length >= 2 ? cells : null
  }

  function isMarkdownTableDivider(text: string) {
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(text)
  }

  function parseInline(text: string) {
    const parts: ReactNode[] = []
    const tokenPattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|(https?:\/\/[^\s<>\])]+)/gi
    let lastIndex = 0
    let match: RegExpExecArray | null = tokenPattern.exec(text)

    while (match) {
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
      }
      if (match[1] !== undefined && match[2] !== undefined) {
        parts.push(
          <img
            key={`image-${match.index}`}
            src={match[2]}
            alt={match[1] || '图片'}
            loading="lazy"
          />,
        )
      } else if (match[3] !== undefined && match[4] !== undefined) {
        parts.push(
          <a
            key={`link-${match.index}`}
            href={match[4]}
            target="_blank"
            rel="noreferrer"
          >
            {match[3]}
          </a>,
        )
      } else if (match[5] !== undefined) {
        parts.push(<strong key={`bold-${match.index}`}>{match[5]}</strong>)
      } else if (match[6] !== undefined) {
        parts.push(
          <a
            key={`url-${match.index}`}
            href={match[6]}
            target="_blank"
            rel="noreferrer"
          >
            {match[6]}
          </a>,
        )
      }
      lastIndex = tokenPattern.lastIndex
      match = tokenPattern.exec(text)
    }

    if (lastIndex < text.length) {
      parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>)
    }

    return parts.length > 0 ? parts : [<span key="text-empty">{text}</span>]
  }

  function renderHeading(level: number, text: string, key: number) {
    if (level <= 1) return <h3 key={key}>{parseInline(text)}</h3>
    if (level === 2) return <h4 key={key}>{parseInline(text)}</h4>
    return <h5 key={key}>{parseInline(text)}</h5>
  }

  while (index < lines.length) {
    const text = lines[index].trim()

    if (!text) {
      index += 1
      continue
    }

    if (/^---+$/.test(text)) {
      blocks.push(<hr key={index} />)
      index += 1
      resetOrderedListSequence()
      continue
    }

    const heading = text.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push(renderHeading(heading[1].length, heading[2], index))
      index += 1
      resetOrderedListSequence()
      continue
    }

    const tableCells = parseTableCells(text)
    if (tableCells) {
      const tableItems: ReactNode[] = []
      while (index < lines.length) {
        const rowText = lines[index].trim()
        if (!rowText) {
          index += 1
          continue
        }
        if (isMarkdownTableDivider(rowText)) {
          index += 1
          continue
        }
        const rowCells = parseTableCells(rowText)
        if (!rowCells) break
        const item = rowCells.length >= 3
          ? `${rowCells[0]}：${rowCells[1]}；${rowCells.slice(2).join('；')}`
          : rowCells.join('：')
        tableItems.push(<li key={index}>{parseInline(item)}</li>)
        index += 1
      }
      blocks.push(<ul key={`table-${index}`}>{tableItems}</ul>)
      resetOrderedListSequence()
      continue
    }

    if (/^[-*]\s+/.test(text)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^[-*]\s+/, '')
        items.push(<li key={index}>{parseInline(item)}</li>)
        index += 1
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>)
      continue
    }

    const orderedListMatch = text.match(/^(\d+)[.)]\s+/)
    if (orderedListMatch) {
      const items: ReactNode[] = []
      const sourceStart = Number(orderedListMatch[1])
      const listStart = canContinueOrderedList && sourceStart === 1 ? nextOrderedListStart : sourceStart
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^\d+[.)]\s+/, '')
        items.push(<li key={index}>{parseInline(item)}</li>)
        index += 1
      }
      blocks.push(
        <ol key={`ol-${index}`} start={listStart}>
          {items}
        </ol>,
      )
      nextOrderedListStart = listStart + items.length
      canContinueOrderedList = true
      continue
    }

    if (isMarkdownSectionLine(text)) {
      const [title, ...rest] = text.split(/[：:]/)
      blocks.push(
        <section className="markdown-section" key={index}>
          <h4>{parseInline(title)}</h4>
          {rest.join('：').trim() && <p>{parseInline(rest.join('：').trim())}</p>}
        </section>,
      )
      index += 1
      resetOrderedListSequence()
      continue
    }

    blocks.push(<p key={index}>{parseInline(text)}</p>)
    index += 1
    resetOrderedListSequence()
  }

  return <div className={compact ? 'markdown-preview compact' : 'markdown-preview'}>{blocks}</div>
}
