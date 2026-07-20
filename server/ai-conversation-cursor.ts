const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function encodeAiConversationCursor(lastTurnAt: string, id: string) {
  return Buffer.from(JSON.stringify([lastTurnAt, id])).toString('base64url')
}

export function decodeAiConversationCursor(cursor: string) {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    !Number.isFinite(new Date(parsed[0]).getTime()) ||
    !uuidPattern.test(parsed[1])
  ) {
    throw new Error('invalid AI conversation cursor')
  }
  return { id: parsed[1], lastTurnAt: parsed[0] }
}
