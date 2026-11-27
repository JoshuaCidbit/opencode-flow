// Arnés de INTEGRACIÓN: levanta el plugin real (`Plugin.define`) contra un `ctx` falso y
// dispara los HOOKS REGISTRADOS, no sólo las funciones auxiliares.
//
// Por qué existe: los tests de `gate.ts` comprueban la política, pero el bug real de esta
// ronda estaba en el CABLEADO — el hook `execute.before` no pasaba `ticketsOpted` a
// `verdictFor`, así que adoptar tickets no endurecía nada. Ese fallo sólo se ve ejercitando
// el hook, igual que lo dispara el runtime.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../src/index.ts"
import { MAX_SLUG } from "../src/slug.ts"

type HookName = string
type Hook = (event: unknown) => Promise<unknown>
type FlowState = Record<string, unknown> & { fase: number }

export type Harness = {
  /** Proyecto temporal (raíz del gate). */
  readonly root: string
  /** Estado en storage por clave (`flow:<sessionID>`). */
  readonly store: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    entries(): Map<string, unknown>
  }
  /** Textos emitidos por `synthetic` (las respuestas de comando). */
  readonly replies: string[]
  /** Ejecuta `/flow ...` por la vía real: el execute que registró el plugin. */
  run(sessionID: string, text: string): Promise<void>
  /** Dispara `execute.before` como el runtime. Devuelve el mensaje de error, o undefined. */
  write(sessionID: string, file: string, tool?: string): Promise<string | undefined>
  /** Lee el estado persistido de una sesión. */
  state(sessionID: string): FlowState | undefined
  /** Dispara el hook `context` y devuelve `event.system` (lo que el modelo recibe). */
  context(sessionID: string): Promise<string | undefined>
  /** Dispara el hook `generate` y devuelve `event.system`. */
  generate(sessionID: string): Promise<string | undefined>
  /** Dispara el hook `compaction` y devuelve `event.system`. */
  compaction(sessionID: string, messages?: unknown[]): Promise<string | undefined>
  /** Entradas `opencode-flow.*` en instructions, en el orden en que se pusieron/borraron. */
  readonly entries: Map<string, unknown>
  /** Conteo de escrituras en instructions (`entry.put`). */
  writes(): number
  /** Conteo de borrados en instructions (`entry.remove`). */
  removes(): number
}

/** `ctx` mínimo pero HONESTO: mismo cableado que el runtime, dobles en vez de cliente HTTP. */
export async function harness(initial?: {
  root?: string
  /** Estado inicial por sessionID (sin prefijo `flow:`). */
  states?: Record<string, FlowState>
}): Promise<Harness> {
  const root = initial?.root ?? mkdtempSync(join(tmpdir(), "flow-hook-"))
  const map = new Map<string, unknown>()
  for (const [sessionID, value] of Object.entries(initial?.states ?? {})) {
    map.set(`flow:${sessionID}`, value)
  }

  const replies: string[] = []
  const hooks = new Map<HookName, Hook[]>()
  const sessionHooks = new Map<HookName, Hook[]>()
  let execute: ((input: { sessionID: string; prompt?: unknown }) => Promise<void>) | undefined

  const entries = new Map<string, unknown>()
  const entryPuts: number[] = []
  const entryRemoves: number[] = []
  const store = {
    async get(key: string) {
      return map.get(key)
    },
    async set(key: string, value: unknown) {
      map.set(key, value)
    },
    entries() {
      return map
    },
  }

  // Firma REAL del runtime: `hook(name, callback)` con DOS argumentos. Currificarlo tragaría
  // el callback en silencio y el arnés parecería funcionar sin registrar nada.
  const record = (bucket: Map<HookName, Hook[]>) => async (name: HookName, hook: Hook) => {
    const list = bucket.get(name) ?? []
    list.push(hook)
    bucket.set(name, list)
    return { dispose: async () => undefined }
  }

  const ctx = {
    // El plugin resuelve el proyecto desde aquí: sin esto, el gate miraría otro cwd.
    location: { project: { directory: root } },
    options: {},
    storage: store,
    logger: { error: () => undefined, debug: () => undefined },
    session: {
      get: async () => undefined,
      hook: record(sessionHooks),
      instructions: {
        entry: {
          put: async (key: string, value: unknown) => {
            entryPuts.push(1)
            entries.set(key, value)
          },
          remove: async (key: string) => {
            entryRemoves.push(1)
            entries.delete(key)
          },
        },
      },
      synthetic: async (input: { text?: string }) => {
        replies.push(String(input.text ?? ""))
      },
      prompt: async (input: { text: string }) => {
        replies.push(input.text)
      },
    },
    tool: {
      hook: record(hooks),
    },
    command: {
      // El runtime pasa un CALLBACK al que entrega un editor; el plugin hace `editor.add({ execute })`.
      // Se captura ese execute para que `run` ejercite el mismo camino que un `/flow` de verdad.
      transform: async (apply: (editor: { add: (command: { execute: (input: { sessionID: string; prompt?: unknown }) => Promise<void> }) => void }) => void) => {
        apply({
          add: (command: { execute: (input: { sessionID: string; prompt?: unknown }) => Promise<void> }) => {
            execute = command.execute
          },
        })
        return { dispose: async () => undefined }
      },
    },
    skill: {
      transform: async () => ({ dispose: async () => undefined }),
    },
  }

  await plugin.setup(ctx as never)

  const run = async (sessionID: string, text: string) => {
    if (!execute) throw new Error("el plugin no registró /flow")
    await execute({ sessionID, prompt: text })
  }

  const write = async (sessionID: string, file: string, tool = "write") => {
    const list = hooks.get("execute.before") ?? []
    assert.ok(list.length > 0, "el plugin no registró execute.before: el gate está desarmado")
    for (const hook of list) {
      try {
        await hook({ tool, sessionID, input: { filePath: file } })
      } catch (error) {
        return (error as Error).message
      }
    }
    return undefined
  }

  // Mismo cableado que el runtime: el hook recibe `event` y lo que ve el modelo es
  // `event.system`. Sin esta función no se puede comprobar QUÉ recibe el modelo.
  // El runtime entrega `system` como ARRAY de partes (medido en 2.4.2): si aquí fuera un
  // string, el plugin se callaría y el test daría verde sin inyectar nada.
  const fire = async (kind: string, extra: Record<string, unknown> = {}) => {
    const list = sessionHooks.get(kind) ?? []
    assert.ok(list.length > 0, `el plugin no registró el hook ${kind}`)
    const system: Array<{ type?: string; text?: string }> = []
    const event = { sessionID: extra.sessionID ?? "s1", system, ...extra }
    for (const hook of list) await hook(event)
    const text = system.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
    return text.length > 0 ? text : undefined
  }
  const context = (sessionID: string) => fire("context", { sessionID })
  const generate = (sessionID: string) => fire("generate", { sessionID })
  const compaction = (sessionID: string, messages: unknown[] = []) => fire("compaction", { sessionID, messages })

  return {
    root,
    store,
    replies,
    entries,
    run,
    write,
    context,
    generate,
    compaction,
    state: (id) => map.get(`flow:${id}`) as FlowState | undefined,
    writes: () => entryPuts.length,
    removes: () => entryRemoves.length,
  }
}

/** `spec.md` con contenido: evidencia necesaria (pero no suficiente) para escribir código. */
export function spec(root: string, feature = "auth"): void {
  mkdirSync(join(root, ".scratch", feature), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "spec.md"), "# Spec\n\nDe verdad.\n")
}

/** Un ticket en `issues/`: única forma de cerrar la fase 6. */
export function ticket(root: string, feature = "auth", name = "001.md"): void {
  mkdirSync(join(root, ".scratch", feature, "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "issues", name), `# Ticket ${name}\n\nCuerpo.\n`)
}

// --- (a) fase 7 con compromiso y sin tickets -> execute.before bloquea una escritura en src/ ---

test("hooks (a): fase 7 con compromiso bloquea src/ mientras no haya tickets", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-hook-real-"))
  spec(root)
  const h = await harness({ root })
  await h.run("s1", "start 5 auth")
  await h.run("s1", "gate tickets") // cierra la 6 -> fase 7 con compromiso

  const state = h.state("s1")
  assert.equal(state?.fase, 7)
  assert.equal(state?.ticketsOpted, true, "cerrar la puerta de tickets ES comprometerse")

  const blocked = await h.write("s1", join(root, "src/app.ts"))
  assert.match(String(blocked), /^GATE:/, "sin tickets en disco, el código del proyecto se bloquea")
  assert.match(String(blocked), /tickets/)

  ticket(root)
  assert.equal(await h.write("s1", join(root, "src/app.ts")), undefined, "con tickets, se abre")
})

test("hooks (a): fase 7 SIN compromiso no exige tickets (camino tdd)", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-hook-tdd-"))
  spec(root)
  const h = await harness({ root })
  await h.run("s1", "start 7 auth")
  assert.equal(h.state("s1")?.ticketsOpted, undefined, "empezar en la 7 no promete tickets")
  assert.equal(await h.write("s1", join(root, "src/app.ts")), undefined, "tdd escribe código sin tickets")
})

// --- (b) auto-avance 6->7 por ticket -> ticketsOpted:true y se aplica en la siguiente escritura ---

test("hooks (b): el ticket creado mueve 6 -> 7, fija ticketsOpted y el hook lo usa", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-hook-auto-"))
  spec(root)
  // Arranca en la 6 sin tickets; el ticket aparece DESPUÉS (lo normal: se crea en la 6).
  const h = await harness({ root })
  await h.run("s1", "start 6 auth")
  assert.equal(h.state("s1")?.fase, 6)
  ticket(root)

  // La escritura dispara la lectura, que detecta el artefacto y auto-avanza.
  await h.write("s1", join(root, "src/app.ts"))
  const moved = h.state("s1")
  assert.equal(moved?.fase, 7, "el ticket en disco mueve 6 -> 7")
  assert.equal(moved?.ticketsOpted, true, "si el ticket movió la fase, hubo compromiso")

  // Y el commit persiste: la SIGUIENTE escritura ya se evalúa con ese estado.
  assert.equal(await h.write("s1", join(root, "src/app.ts")), undefined)
})

// --- (c) /flow status y execute.before dan el MISMO veredicto en ambos estados ---

test("hooks (c): status y execute.before coinciden con y sin tickets", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-hook-status-"))
  spec(root)
  const h = await harness({ root })
  await h.run("s1", "start 5 auth")
  await h.run("s1", "gate tickets")

  h.replies.length = 0
  await h.run("s1", "status")
  assert.match(h.replies.join("\n"), /cerrado \(falta tickets\)/, "status dice que falta tickets")
  assert.match(String(await h.write("s1", join(root, "src/app.ts"))), /^GATE:/, "y el hook bloquea")

  ticket(root)
  h.replies.length = 0
  await h.run("s1", "status")
  assert.match(h.replies.join("\n"), /abierto \(spec presente \+ tickets\)/)
  assert.equal(await h.write("s1", join(root, "src/app.ts")), undefined, "y el hook permite")
})

test("hooks (c): en camino tdd, ni status ni hook piden tickets", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-hook-status-tdd-"))
  spec(root)
  const h = await harness({ root })
  await h.run("s1", "start 7 auth")

  h.replies.length = 0
  await h.run("s1", "status")
  assert.match(h.replies.join("\n"), /abierto \(spec presente\)/)
  assert.equal(await h.write("s1", join(root, "src/app.ts")), undefined)
})

// --- (3) /flow resume: dice qué dedujo y por qué; storage manda sobre el disco ---

test("resume: sin estado, dedice del disco y explica qué artefacto lo sostiene", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-resume-why-"))
  spec(root)
  const h = await harness({ root })
  h.replies.length = 0
  await h.run("s1", "resume auth")
  const message = h.replies.join("\n")
  assert.equal(h.state("s1")?.fase, 6, "con spec se retoma en la 6")
  assert.match(message, /deducid/, "dice que la fase es deducida")
  assert.match(message, /spec/, "y nombra el artefacto que la sostiene")
  assert.match(message, /\/flow back/, "y avisa de cómo corregir un borrador no aprobado")
})

test("resume: el estado en storage TIENE PRIORIDAD sobre la deducción por disco", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-resume-priority-"))
  spec(root) // el disco deduciría 6
  const h = await harness({
    root,
    states: { s1: { fase: 3, feature: "auth", active: true, gate: "checkpoint" } },
  })
  h.replies.length = 0
  await h.run("s1", "resume")
  const message = h.replies.join("\n")
  assert.equal(h.state("s1")?.fase, 3, "la fase guardada (3) no se sustituye por la deducida (6)")
  assert.match(message, /estado guardado/, "y el mensaje dice de dónde viene la fase")
  assert.match(message, /\/flow back/, "avisando de cómo corregirla")
})

// --- P1: lo que el MODELO recibe (no lo que el plugin calcula) -------------------------
// El bug de P1 era de cableado: la prosa decía `<feature>` y nadie resolvía ese placeholder,
// así que el modelo no sabía en qué directorio escribir y `resume` siempre caía a la fase 1.
test("P1 (cableado): en fase 1 el contrato inyectado lleva el slug concreto y las reglas", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-hook-p1-"))
  const h = await harness({ root })
  await h.run("s1", "start 1 abc")
  const injected = await h.context("s1")
  assert.ok(injected, "el hook context no inyectó nada")
  assert.ok(injected.includes(".scratch/abc/understanding.md"), "la ruta lleva el slug concreto, no el placeholder")
  assert.ok(!injected.includes("<feature>"), "sin placeholders de ruta sin resolver")
  assert.match(injected, /una pregunta por turno/i, "la regla de una pregunta por turno llega al modelo")
  assert.match(injected, /Sondear|grilling|Explora antes de preguntar/)
})

// P1: `push()` es el ÚNICO punto de salida de texto al modelo (src/index.ts:323-331), así que
// basta comprobar cada hook que lo usa. `context` y `generate` comparten el mismo bucle, por
// eso ambos resuelven `<feature>`; `compaction` inyecta el addendum por la misma función.
for (const kind of ["context", "generate"] as const) {
  test(`P1 (cableado): el hook ${kind} resuelve <feature> en fase 1`, async () => {
    const root = mkdtempSync(join(tmpdir(), `flow-hook-${kind}-`))
    const h = await harness({ root })
    await h.run("s1", "start 1 abc")
    const injected = kind === "context" ? await h.context("s1") : await h.generate("s1")
    assert.ok(injected, `el hook ${kind} no inyectó nada`)
    assert.ok(injected.includes(".scratch/abc/understanding.md"), `${kind}: la ruta no lleva el slug`)
    assert.ok(!injected.includes("<feature>"), `${kind}: queda un placeholder <feature> literal`)
  })
}

test("P1 (cableado): compaction inyecta el addendum con la fase y la feature reales", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-hook-compaction-"))
  const h = await harness({ root })
  await h.run("s1", "start 3 abc")
  const injected = await h.compaction("s1")
  assert.ok(injected, "el hook compaction no inyectó nada")
  assert.match(injected, /fase 3/)
  assert.match(injected, /Feature: abc/)
  assert.ok(!injected.includes("<feature>"), "compaction: queda un placeholder <feature> literal")
})

// Presupuesto por el CAMINO REAL: los hooks `context` y `generate` con `MAX_SLUG` de `slug.ts`.
for (const kind of ["context", "generate"] as const) {
  test(`P1 (presupuesto): el hook ${kind} con slug de ${MAX_SLUG} inyecta <= 7000 B y cero <feature>`, async () => {
    const root = mkdtempSync(join(tmpdir(), `flow-hook-${kind}-slug60-`))
    const longSlug = "a".repeat(MAX_SLUG)
    const h = await harness({ root })
    await h.run("s1", `start 1 ${longSlug}`)
    const injected = kind === "context" ? await h.context("s1") : await h.generate("s1")
    assert.ok(injected, `el hook ${kind} no inyectó nada`)
    const bytes = Buffer.byteLength(injected, "utf8")
    assert.ok(bytes <= 7000, `el hook ${kind} inyecta ${bytes} bytes con slug de ${MAX_SLUG} (techo 7000)`)
    assert.ok(!injected.includes("<feature>"), "quedan placeholders sin resolver")
    assert.ok(injected.includes(`.scratch/${longSlug}/understanding.md`), `la ruta lleva el slug de ${MAX_SLUG}`)
  })
}

// --- P3: la rama de ayuda no tiene efectos ------------------------------------------------
// Un subcomando mal escrito con el flow activo (`stauts`, `nxt`, `of`) debe contestar con ayuda
// y NADA más. Si escribiera estado, un dedazo podría mover la fase o reescribir el entry de
// instructions; aquí se comprueba que no toca ni storage ni instructions.
for (const typo of ["stauts", "nxt", "of"]) {
  test(`P3: "/flow ${typo}" en fase 5 deja el estado idéntico y cero entry.put/remove`, async () => {
    const root = mkdtempSync(join(tmpdir(), `flow-typo-${typo}-`))
    mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
    const before = { fase: 5 as const, feature: "auth", active: true, allow: ["README.md"] }
    const h = await harness({ root, states: { s1: { ...before } } })
    const putsBefore = h.writes()
    const removesBefore = h.removes()
    await h.run("s1", typo)
    // 1) estado idéntico
    assert.deepEqual(h.state("s1"), { ...before }, `el estado cambió con "${typo}"`)
    // 2) cero escrituras y cero borrados en instructions
    assert.equal(h.writes(), putsBefore, `"${typo}" escribió en instructions`)
    assert.equal(h.removes(), removesBefore, `"${typo}" borró de instructions`)
    // 3) y contestó con ayuda, no silencio
    const out = h.replies.join("\n")
    assert.ok(out.includes("Uso: /flow"), `no hubo ayuda con "${typo}"`)
    assert.ok(/no es un subcomando/.test(out), `la ayuda no explica el error: ${out}`)
  })
}

test("P3: la ayuda con flow activo ofrece /flow start para otra feature", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-help-active-"))
  const h = await harness({ root, states: { s1: { fase: 5, feature: "auth", active: true } } })
  await h.run("s1", "stauts")
  const out = h.replies.join("\n")
  assert.match(out, /\/flow start <descripción>/, "falta la salida para empezar otra feature")
  // Y con flow inactivo NO se dice: quien no está en un flow no necesita cambiar de feature.
  const h2 = await harness({ root: mkdtempSync(join(tmpdir(), "flow-help-idle-")) })
  await h2.run("s2", "zzzz")
  const out2 = h2.replies.join("\n")
  assert.ok(!/\/flow start <descripción>/.test(out2), "inactivo no debe llevar el aviso")
})

test("P3: un subcomando válido con argumentos sigue escribiendo estado", async () => {
  // Contrapeso: el test anterior no puede pasar "porque nunca se escribe". Aquí sí se escribe.
  const root = mkdtempSync(join(tmpdir(), "flow-back-writes-"))
  const h = await harness({ root, states: { s1: { fase: 5, feature: "auth", active: true } } })
  await h.run("s1", "back 3")
  assert.equal(h.state("s1")?.fase, 2, "back 3 debe mover a la 2")
})
