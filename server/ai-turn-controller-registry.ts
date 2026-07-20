type ActiveAiTurnController = {
  controller: AbortController
  leaseToken: string
}

export class AiTurnControllerRegistry {
  private readonly controllers = new Map<string, ActiveAiTurnController>()

  private key(turnId: string, leaseToken: string) {
    return `${turnId}:${leaseToken}`
  }

  register(turnId: string, leaseToken: string, controller: AbortController) {
    this.controllers.set(this.key(turnId, leaseToken), { controller, leaseToken })
  }

  abort(turnId: string, leaseToken: string) {
    const active = this.controllers.get(this.key(turnId, leaseToken))
    if (!active) return false
    active.controller.abort()
    return true
  }

  release(turnId: string, leaseToken: string, controller: AbortController) {
    const key = this.key(turnId, leaseToken)
    const active = this.controllers.get(key)
    if (active?.controller === controller) {
      this.controllers.delete(key)
    }
  }
}
