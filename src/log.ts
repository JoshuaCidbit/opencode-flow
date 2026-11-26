// Registro de fallos: una vez por proceso (o por sesión para fallos de petición).
//
// "Silencio total" aplica al flujo conversacional: nada de texto inyectado en cada
// petición. Los fallos de ARRANQUE sí se registran, porque un plugin que no puede
// aplicar su gate debe decirlo. Pero una vez: repetirlo en cada turno es ruido.
//
// Se usa el logger del runtime si existe (A0); si no, console.error.

export type Logger = {
  error(message: string, extra?: unknown): void
  debug?(message: string, extra?: unknown): void
}

/**
 * Admite `ctx.logger` o `ctx.client.app.log` (formas reales del runtime) además de consola.
 * Devuelve siempre un logger usable: nunca lanza.
 */
export function makeLogger(ctx: unknown): Logger {
  const candidates: Array<{ log: Logger; debug?: boolean }> = []

  const runtime = ctx as { logger?: unknown; client?: unknown } | undefined

  const direct = runtime?.logger as
    | { error?: (...args: unknown[]) => void; debug?: (...args: unknown[]) => void }
    | undefined
  if (direct && typeof direct.error === "function") {
    candidates.push({
      log: {
        error: (m, e) => direct.error!(m, e),
        ...(typeof direct.debug === "function" ? { debug: (m, e) => direct.debug!(m, e) } : {}),
      },
      debug: typeof direct.debug === "function",
    })
  }

  const client = runtime?.client as { app?: { log?: unknown } } | undefined
  const appLog = client?.app?.log as
    | { error?: (...args: unknown[]) => void; debug?: (...args: unknown[]) => void }
    | undefined
  if (appLog && typeof appLog.error === "function") {
    candidates.push({
      log: {
        error: (m, e) => appLog.error!(m, e),
        ...(typeof appLog.debug === "function" ? { debug: (m, e) => appLog.debug!(m, e) } : {}),
      },
      debug: typeof appLog.debug === "function",
    })
  }

  const chosen = candidates.find((c) => c.debug) ?? candidates[0]
  if (chosen) return chosen.log

  return {
    error: (message, extra) => {
      if (extra !== undefined) console.error(message, extra)
      else console.error(message)
    },
  }
}

/**
 * Envoltorio que registra cada `key` una sola vez.
 * `seen` vive en memoria de proceso, así que la deduplicación es por proceso.
 */
export class OnceLog {
  private readonly seen = new Set<string>()
  private readonly logger: Logger
  private readonly prefix: string

  constructor(logger: Logger, prefix = "[opencode-flow]") {
    this.logger = logger
    this.prefix = prefix
  }

  once(key: string, message: string, extra?: unknown): boolean {
    const id = `error:${key}`
    if (this.seen.has(id)) return false
    this.seen.add(id)
    this.logger.error(`${this.prefix} ${message}`, extra)
    return true
  }

  error(key: string, message: string, extra?: unknown): boolean {
    return this.once(key, message, extra)
  }

  debug(key: string, message: string, extra?: unknown): boolean {
    if (!this.logger.debug) return false
    const id = `debug:${key}`
    if (this.seen.has(id)) return false
    this.seen.add(id)
    this.logger.debug(`${this.prefix} ${message}`, extra)
    return true
  }

  /** true si ya se registró: útil para no repetir en tests ni en ramas alternas. */
  has(key: string): boolean {
    return this.seen.has(`error:${key}`) || this.seen.has(`debug:${key}`)
  }
}
