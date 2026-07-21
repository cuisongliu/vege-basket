import {
  isAiConversation,
  isAiTurn,
  isAiTurnRunResponse,
  parseAiTurnRunResponse,
  type AiConversation,
  type AiTurn,
  type AiTurnRunResponse,
} from './ai-conversation-wire.ts'

export type DecodedServerSentEvent = {
  data: string
  event: string
}

export const AI_TURN_STREAM_PHASES = [
  'preparing',
  'generating',
  'validating',
  'saving',
] as const

export type AiTurnStreamPhase = (typeof AI_TURN_STREAM_PHASES)[number]
export type AiTurnStreamMode = 'progress' | 'text'
export type AiTurnStreamError = { code: string; message: string }

export type AiTurnStreamEvent =
  | {
      conversation?: AiConversation
      mode: AiTurnStreamMode
      sequence: number
      turn?: AiTurn
      turnId: string
      type: 'started'
    }
  | { append: string; sequence: number; turnId: string; type: 'delta' }
  | { phase: AiTurnStreamPhase; sequence: number; turnId: string; type: 'progress' }
  | { sequence: number; turnId: string; type: 'heartbeat' }
  | { result: AiTurnRunResponse; sequence: number; type: 'completed' }
  | {
      error: AiTurnStreamError
      result?: AiTurnRunResponse | null
      sequence: number
      turnId: string
      type: 'failed' | 'cancelled'
    }

type WithoutSequence<T> = T extends unknown ? Omit<T, 'sequence'> : never

export type AiTurnStreamEventInput = WithoutSequence<AiTurnStreamEvent>

const maxBufferedCharacters = 1_000_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAiTurnStreamPhase(value: unknown): value is AiTurnStreamPhase {
  return typeof value === 'string' && AI_TURN_STREAM_PHASES.includes(value as AiTurnStreamPhase)
}

export function decodeAiTurnStreamEvent(
  frame: DecodedServerSentEvent,
): AiTurnStreamEvent {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(frame.data) as unknown
    if (!isRecord(parsed)) throw new Error('invalid payload')
    payload = parsed
  } catch {
    throw new Error('AI response stream contained an invalid event')
  }

  const sequence = Number(payload.sequence)
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || payload.type !== frame.event) {
    throw new Error('AI response stream contained an invalid event')
  }
  const turnId = typeof payload.turnId === 'string' ? payload.turnId : ''
  if (payload.type === 'started') {
    if (
      !turnId ||
      (payload.mode !== 'progress' && payload.mode !== 'text') ||
      (payload.conversation != null && !isAiConversation(payload.conversation)) ||
      (payload.turn != null && !isAiTurn(payload.turn))
    ) {
      throw new Error('AI response stream contained an invalid event')
    }
  } else if (payload.type === 'delta') {
    if (!turnId || typeof payload.append !== 'string') {
      throw new Error('AI response stream contained an invalid event')
    }
  } else if (payload.type === 'progress') {
    if (!turnId || !isAiTurnStreamPhase(payload.phase)) {
      throw new Error('AI response stream contained an invalid event')
    }
  } else if (payload.type === 'heartbeat') {
    if (!turnId) throw new Error('AI response stream contained an invalid event')
  } else if (payload.type === 'completed') {
    parseAiTurnRunResponse(payload.result)
  } else if (payload.type === 'failed' || payload.type === 'cancelled') {
    if (
      !turnId ||
      !isRecord(payload.error) ||
      typeof payload.error.code !== 'string' ||
      typeof payload.error.message !== 'string' ||
      (payload.result != null && !isAiTurnRunResponse(payload.result))
    ) {
      throw new Error('AI response stream contained an invalid event')
    }
  } else {
    throw new Error('AI response stream contained an unknown event')
  }
  return payload as AiTurnStreamEvent
}

export function serializeAiTurnStreamEvent(event: AiTurnStreamEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export class ServerSentEventDecoder {
  private buffer = ''
  private readonly decoder = new TextDecoder()

  push(chunk: Uint8Array) {
    this.buffer += this.decoder.decode(chunk, { stream: true })
    return this.drain(false)
  }

  finish() {
    this.buffer += this.decoder.decode()
    return this.drain(true)
  }

  private drain(flush: boolean) {
    if (this.buffer.length > maxBufferedCharacters) {
      throw new Error('Server-sent event exceeded the size limit')
    }

    const events: DecodedServerSentEvent[] = []
    while (this.buffer) {
      const boundary = findEventBoundary(this.buffer)
      if (!boundary) break
      const block = this.buffer.slice(0, boundary.index)
      this.buffer = this.buffer.slice(boundary.index + boundary.length)
      const event = decodeEventBlock(block)
      if (event) events.push(event)
    }

    if (flush && this.buffer.trim()) {
      const event = decodeEventBlock(this.buffer)
      this.buffer = ''
      if (event) events.push(event)
    }
    return events
  }
}

function lineBreakLengthAt(value: string, index: number) {
  if (value[index] === '\n') return 1
  if (value[index] !== '\r') return 0
  return value[index + 1] === '\n' ? 2 : 1
}

function findEventBoundary(value: string) {
  for (let index = 0; index < value.length;) {
    const firstLength = lineBreakLengthAt(value, index)
    if (!firstLength) {
      index += 1
      continue
    }
    const secondIndex = index + firstLength
    if (secondIndex >= value.length) return null
    const secondLength = lineBreakLengthAt(value, secondIndex)
    if (secondLength) return { index, length: firstLength + secondLength }
    index = secondIndex
  }
  return null
}

function decodeEventBlock(block: string): DecodedServerSentEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split(/\r\n|\r|\n/u)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const rawValue = separator < 0 ? '' : line.slice(separator + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
    if (field === 'event') event = value || 'message'
    if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  return { data: data.join('\n'), event }
}
