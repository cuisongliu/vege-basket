import type { EventEmitter } from 'node:events'

type AiTurnStreamDrainSource = Pick<EventEmitter, 'once' | 'removeListener'>

export function waitForAiTurnStreamDrain(
  response: AiTurnStreamDrainSource,
  timeoutMs = 5_000,
) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (drained: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      response.removeListener('close', onClose)
      response.removeListener('drain', onDrain)
      resolve(drained)
    }
    const onClose = () => finish(false)
    const onDrain = () => finish(true)
    const timeout = setTimeout(() => finish(false), timeoutMs)
    timeout.unref()
    response.once('close', onClose)
    response.once('drain', onDrain)
  })
}
