import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import plugin from "../src/index.ts"
import { parseCommand, phaseMap, help } from "../src/phases.ts"
import { renderFor } from "../src/contract.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..")
const CONTRACT = readFileSync(join(ROOT, "flow.md"), "utf8")

async function miniHarness(states: Record<string, Record<string, unknown>> = {}) {
  const root = mkdtempSync(join(tmpdir(), "flow-imp-"))
  const map = new Map<string, unknown>(Object.entries(states).map(([k, v]) => [`flow:${k}`, v]))
  const replies: string[] = []
  let puts = 0
  let execute: ((input: { sessionID: string; prompt?: unknown }) => Promise<void>) | undefined

  await plugin.setup({
    location: { project: { directory: root } },
    options: {},
    storage: {
      get: async (k: string) => map.get(k),
      set: async (k: string, v: unknown) => {
        map.set(k, v)
      },
    },
    logger: { error: () => undefined, debug: () => undefined },
    session: {
      get: async () => undefined,
      hook: async () => ({ dispose: async () => undefined }),
      instructions: {
        entry: {
          put: async () => {
            puts++
          },
          remove: async () => undefined,
        },
      },
      synthetic: async (input: { text?: string }) => {
        replies.push(String(input.text ?? ""))
      },
    },
    tool: { hook: async () => ({ dispose: async () => undefined }) },
    command: {
      transform: async (apply: (ed: { add: (cmd: { execute: typeof execute }) => void }) => void) => {
        apply({
          add: (cmd) => {
            execute = cmd.execute
          },
        })
        return { dispose: async () => undefined }
      },
    },
    skill: { transform: async () => ({ dispose: async () => undefined }) },
  } as never)

  return {
    replies,
    writes: () => puts,
    state: (id: string) => map.get(`flow:${id}`) as { fase?: number } | undefined,
    run: async (sessionID: string, prompt: string) => {
      if (!execute) throw new Error("comando no registrado")
      await execute({ sessionID, prompt })
    },
  }
}

test("map: /flow map imprime las 10 fases sin alterar el estado", async () => {
  assert.equal(parseCommand("map").kind, "map")
  assert.equal(parseCommand("MAP", { active: true }).kind, "map")
  assert.match(help(), /\bmap\b/)

  const h = await miniHarness({ s1: { fase: 4, feature: "auth", active: true } })
  const putsBefore = h.writes()

  await h.run("s1", "map")

  assert.equal(h.state("s1")?.fase, 4)
  assert.equal(h.writes(), putsBefore)
  assert.equal(h.replies.join("\n"), phaseMap())
})

test("gate: cerrar un gate anterior no retrocede la fase actual", async () => {
  const h = await miniHarness()
  await h.run("s1", "start 8 auth")
  assert.equal(h.state("s1")?.fase, 8)

  await h.run("s1", "gate spec")
  assert.equal(h.state("s1")?.fase, 8)

  await h.run("s1", "gate review")
  assert.equal(h.state("s1")?.fase, 9)
})

test("contract: fases tempranas recortan secciones no aplicables del bloque común", () => {
  const f1 = renderFor(CONTRACT, 1).text
  const f2 = renderFor(CONTRACT, 2).text
  const f7 = renderFor(CONTRACT, 7).text

  assert.match(f1, /## Formato del checkpoint \(fase 1\)/)
  assert.ok(!f1.includes("## Verificación (escalera)"))
  assert.ok(!f2.includes("## Formato del checkpoint (fase 1)"))
  assert.ok(!f2.includes("## Verificación (escalera)"))
  assert.match(f7, /## Verificación \(escalera\)/)
  assert.ok(Buffer.byteLength(f2, "utf8") < Buffer.byteLength(f7, "utf8"))
})

test("skills: ninguna skill empaquetada exige setup-matt-pocock-skills", () => {
  const skillsDir = join(ROOT, "skills")
  for (const cat of readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const catPath = join(skillsDir, cat.name)
    for (const skill of readdirSync(catPath, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const content = readFileSync(join(catPath, skill.name, "SKILL.md"), "utf8")
      assert.ok(
        !content.includes("setup-matt-pocock-skills"),
        `${cat.name}/${skill.name}/SKILL.md aún referencia setup-matt-pocock-skills`,
      )
    }
  }
})

test("v0.3.2: comandos de arranque/avance despiertan turno (resume:true) y consultas no (resume:false)", async () => {
  const { default: plugin } = await import("../src/index.ts")
  const { mkdtempSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")

  const dir = mkdtempSync(join(tmpdir(), "flow-v032-"))
  const store = new Map<string, unknown>()
  const calls: Array<{ text?: string; resume?: boolean }> = []
  let cmdHandler: ((input: { sessionID: string; prompt?: unknown }) => Promise<void>) | undefined

  await plugin.setup({
    location: { project: { directory: dir } },
    options: {},
    storage: {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => { store.set(k, v) },
    },
    logger: { error: () => undefined, debug: () => undefined },
    session: {
      get: async () => undefined,
      hook: async () => ({ dispose: async () => undefined }),
      instructions: {
        entry: {
          put: async () => undefined,
          remove: async () => undefined,
        },
      },
      synthetic: async (input: { text?: string; resume?: boolean }) => {
        calls.push(input)
      },
    },
    tool: { hook: async () => ({ dispose: async () => undefined }) },
    command: {
      transform: async (apply: (ed: { add: (cmd: { execute: (input: { sessionID: string; prompt?: unknown }) => Promise<void> }) => void }) => void) => {
        apply({ add: (cmd) => { cmdHandler = cmd.execute } })
        return { dispose: async () => undefined }
      },
    },
    skill: { transform: async () => ({ dispose: async () => undefined }) },
  } as never)

  assert.ok(cmdHandler, "comando /flow registrado")

  await cmdHandler({ sessionID: "s1", prompt: "mi feature" })
  assert.equal(calls.at(-1)?.resume, true, "start debe usar resume:true")

  await cmdHandler({ sessionID: "s1", prompt: "status" })
  assert.equal(calls.at(-1)?.resume, false, "status debe mantener resume:false")

  await cmdHandler({ sessionID: "s1", prompt: "map" })
  assert.equal(calls.at(-1)?.resume, false, "map debe mantener resume:false")

  await cmdHandler({ sessionID: "s1", prompt: "gate spec" })
  assert.equal(calls.at(-1)?.resume, true, "gate debe usar resume:true")

  await cmdHandler({ sessionID: "s1", prompt: "off" })
  assert.equal(calls.at(-1)?.resume, false, "off debe mantener resume:false")

  await cmdHandler({ sessionID: "s1", prompt: "resume mi-feature" })
  assert.equal(calls.at(-1)?.resume, true, "resume debe usar resume:true")
})
