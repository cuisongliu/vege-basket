export function isMarkdownSectionLine(text: string) {
  return !/^https?:\/\//i.test(text) && /^[^：:]{2,12}[：:]/.test(text)
}

/**
 * Tiptap can preserve a pasted URL's visual line break inside link Markdown.
 * Keep the link as one inline token so the preview renders the link target once.
 */
export function normalizeMarkdownLinkLineBreaks(content: string) {
  return content
    .replace(/\b(https?)(?:\s*:\s*)?\s*\/\s*\/\s*/gi, '$1://')
    .replace(/\]\s*\(/g, '](')
    .replace(
      /\[\s*(https?)(?:\s*:\s*)?\s*\/\s*\/\s*([^\]]+?)\s*\]\s*\(\s*(https?)(?:\s*:\s*)?\s*\/\s*\/\s*([^)]+?)\s*\)/gis,
      (_match, labelProtocol: string, labelPath: string, hrefProtocol: string, hrefPath: string) =>
        `[${labelProtocol}://${labelPath.replace(/\s+/g, '').trim()}](${hrefProtocol}://${hrefPath.replace(/\s+/g, '').trim()})`,
    )
}

/** Todo details keep pasted/linked URLs as visible plain text on save. */
export function stripMarkdownLinksToText(content: string) {
  const normalized = normalizeMarkdownLinkLineBreaks(content)
  return normalized.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1')
}
