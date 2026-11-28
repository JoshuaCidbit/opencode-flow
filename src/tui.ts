import { existsSync, readdirSync, readFileSync, unlinkSync, watch } from "node:fs"
import { tmpdir } from "node:os"
import { Plugin } from "@opencode/plugin/tui"

import {
  onFeedback,
  type FeedbackPayload,
  type FeedbackVariant,
} from "./visibility.ts"

type ToastOptions = {
  readonly title?: string
  readonly message: string
  readonly variant?: FeedbackVariant
  readonly duration?: number
  readonly sessionID?: string
}

type KeymapCommandLike = {
  readonly id?: string
  readonly title?: string
  readonly description?: string
  readonly group?: string
  readonly palette?: true
  readonly slash?: {
    readonly name: string
    readonly aliases?: string[]
    readonly arguments?: true
  }
  readonly suggested?: boolean
  readonly run: (input?: string) => void | false | Promise<void>
}

export type TuiPluginContext = {
  readonly client?: {
    readonly session?: {
      readonly create?: (input?: Record<string, unknown>) => Promise<{ readonly id?: string; readonly data?: { readonly id?: string } }>
      readonly command?: (input: {
        readonly sessionID: string
        readonly name: string
        readonly text: string
      }) => Promise<unknown>
    }
  }
  readonly data?: {
    readonly listen?: (handler: (event: { details?: unknown }) => void) => () => void
    readonly session?: {
      readonly list?: () => readonly { readonly id?: string }[]
    }
  }
  readonly keymap?: {
    readonly layer?: (factory: () => { readonly commands?: readonly KeymapCommandLike[] }) => void
  }
  readonly ui?: {
    readonly toast?: {
      readonly show?: (options: ToastOptions) => void
    }
    readonly dialog?: {
      readonly alert?: (options: { readonly title: string; readonly message: string }) => Promise<void>
    }
    readonly router?: {
      readonly navigate?: (destination: { readonly type: "session"; readonly sessionID: string }) => void
      readonly current?: () => { readonly type?: string; readonly sessionID?: string }
    }
  }
}

export const FLOW_SUBCOMMANDS: ReadonlyArray<{
  readonly id: string
  readonly subcommand: string
  readonly title: string
  readonly description: string
  readonly promptTemplate: string
}> = [
  {
    id: "opencode-flow.start",
    subcommand: "start",
    title: "Flow: Start (iniciar pipeline)",
    description: "Inicia el flujo en fase 1 (o fase N) con slug opcional · Ej: /flow start 1 mi-feature",
    promptTemplate: "/flow start 1 ",
  },
  {
    id: "opencode-flow.status",
    subcommand: "status",
    title: "Flow: Status (estado actual · 0 tokens)",
    description: "Muestra fase actual, feature activa, gate pendiente y tema sin gastar tokens",
    promptTemplate: "/flow status",
  },
  {
    id: "opencode-flow.map",
    subcommand: "map",
    title: "Flow: Map (tabla de 10 fases · 0 tokens)",
    description: "Abre el mapa completo de las 10 fases, skills y artefactos gate en pantalla",
    promptTemplate: "/flow map",
  },
  {
    id: "opencode-flow.gate",
    subcommand: "gate",
    title: "Flow: Gate (aprobar checkpoint y avanzar)",
    description: "Aprueba un gate explícito (spec, tickets, plan, etc.) y avanza de fase",
    promptTemplate: "/flow gate ",
  },
  {
    id: "opencode-flow.next",
    subcommand: "next",
    title: "Flow: Next (siguiente fase)",
    description: "Avanza manualmente a la siguiente fase del pipeline",
    promptTemplate: "/flow next",
  },
  {
    id: "opencode-flow.back",
    subcommand: "back",
    title: "Flow: Back (retroceder fases)",
    description: "Retrocede N fases (por defecto 1) reabriendo el gate correspondiente",
    promptTemplate: "/flow back 1",
  },
  {
    id: "opencode-flow.rename",
    subcommand: "rename",
    title: "Flow: Rename (renombrar slug · 0 tokens)",
    description: "Renombra la feature activa y mueve su carpeta en .scratch/ sin gastar tokens",
    promptTemplate: "/flow rename ",
  },
  {
    id: "opencode-flow.resume",
    subcommand: "resume",
    title: "Flow: Resume (retomar sesión o .flow-feature)",
    description: "Reactiva un flujo pausado o deduce la fase desde .scratch/ y .flow-feature",
    promptTemplate: "/flow resume",
  },
  {
    id: "opencode-flow.off",
    subcommand: "off",
    title: "Flow: Off (desactivar gate · 0 tokens)",
    description: "Desactiva el flujo en esta sesión conservando fase y feature para /flow resume",
    promptTemplate: "/flow off",
  },
  {
    id: "opencode-flow.help",
    subcommand: "help",
    title: "Flow: Help (ayuda y comandos · 0 tokens)",
    description: "Muestra todos los subcomandos disponibles de /flow y sus reglas sin gastar tokens",
    promptTemplate: "/flow help",
  },
]

function isFeedbackPayload(value: unknown): value is FeedbackPayload {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.message === "string" &&
    (v.display === "toast" || v.display === "dialog")
  )
}

export function renderFeedback(ui: TuiPluginContext["ui"], payload: FeedbackPayload): void {
  if (!ui) return
  if (payload.display === "dialog" && typeof ui.dialog?.alert === "function") {
    void ui.dialog.alert({ title: payload.title, message: payload.message })
    return
  }
  if (typeof ui.toast?.show === "function") {
    ui.toast.show({
      title: payload.title,
      message: payload.message,
      variant: payload.variant ?? "info",
      duration: payload.kind === "status" ? 6000 : 4500,
    })
  }
}

export function setupTui(ctx: TuiPluginContext): () => void {
  const bootedAt = Date.now()
  const seen = new Set<string>()
  const cleanups: Array<() => void> = []

  const ensureSessionID = async (): Promise<string | undefined> => {
    const route = ctx.ui?.router?.current?.()
    if (route?.type === "session" && typeof route.sessionID === "string") return route.sessionID
    const list = ctx.data?.session?.list?.()
    if (list && list.length > 0 && typeof list[0]?.id === "string") return list[0].id
    if (typeof ctx.client?.session?.create === "function") {
      const created = await ctx.client.session.create({})
      const id = created?.id ?? created?.data?.id
      if (typeof id === "string" && id.length > 0) {
        ctx.ui?.router?.navigate?.({ type: "session", sessionID: id })
        return id
      }
    }
    return undefined
  }

  const dispatchFlow = async (raw?: string): Promise<void> => {
    const sessionID = await ensureSessionID()
    if (!sessionID || typeof ctx.client?.session?.command !== "function") return
    const trimmed = (raw ?? "").trim()
    const withoutSlash = trimmed.replace(/^\/(?:flow|workflow)\s*/i, "")
    const text = withoutSlash.length > 0 ? withoutSlash : "help"
    await ctx.client.session.command({
      sessionID,
      name: "flow",
      text,
    })
  }

  if (typeof ctx.keymap?.layer === "function") {
    ctx.keymap.layer(() => ({
      commands: [
        {
          id: "opencode-flow.main",
          title: "Flow: Pipeline de 10 fases",
          description: "Subcomandos: start · status · map · gate · next · back · rename · resume · off · help",
          group: "opencode-flow",
          palette: true,
          suggested: true,
          slash: { name: "flow", aliases: ["workflow"], arguments: true },
          run: (input?: string) => dispatchFlow(input),
        },
        ...FLOW_SUBCOMMANDS.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          group: "opencode-flow",
          palette: true as const,
          run: () => dispatchFlow(item.promptTemplate),
        })),
      ],
    }))
  }

  const deliver = (payload: FeedbackPayload): void => {
    if (seen.has(payload.id)) return
    seen.add(payload.id)
    if (seen.size > 100) {
      const oldest = seen.values().next().value
      if (oldest) seen.delete(oldest)
    }
    renderFeedback(ctx.ui, payload)
  }

  const offBus = onFeedback((_sessionID, payload) => {
    deliver(payload)
  })
  cleanups.push(offBus)

  const tmpDir = tmpdir()
  const prefix = "opencode-flow-fb-"

  const consumeFile = (file: string): void => {
    try {
      if (!existsSync(file)) return
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { payload?: unknown }
      if (!isFeedbackPayload(parsed.payload)) return
      try {
        unlinkSync(file)
      } catch {
        // Ignorar si otra instancia ya lo consumió.
      }
      const createdAt = Number(parsed.payload.id.split("-")[0])
      if (Number.isFinite(createdAt) && createdAt < bootedAt) return
      deliver(parsed.payload)
    } catch {
      // Ignorar lecturas parciales mientras el servidor escribe el archivo.
    }
  }

  const scanTmpDir = (): void => {
    try {
      for (const name of readdirSync(tmpDir)) {
        if (name.startsWith(prefix) && name.endsWith(".json")) {
          consumeFile(`${tmpDir}/${name}`)
        }
      }
    } catch {
      // Ignorar errores transitorios de lectura de directorio.
    }
  }

  scanTmpDir()
  let fsWatcher: ReturnType<typeof watch> | undefined
  try {
    fsWatcher = watch(tmpDir, (_eventType, filename) => {
      if (typeof filename === "string" && filename.startsWith(prefix) && filename.endsWith(".json")) {
        consumeFile(`${tmpDir}/${filename}`)
      }
    })
  } catch {
    // Fallback al polling periódico si fs.watch no está disponible.
  }
  const pollTimer = setInterval(scanTmpDir, 250)
  cleanups.push(() => {
    clearInterval(pollTimer)
    fsWatcher?.close()
  })

  return () => {
    for (const fn of cleanups) fn()
  }
}

export default Plugin.define({
  id: "opencode-flow",
  setup: (ctx) => setupTui(ctx as unknown as TuiPluginContext),
})
