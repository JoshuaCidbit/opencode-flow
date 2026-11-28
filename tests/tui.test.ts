import { test } from "node:test"
import assert from "node:assert/strict"
import { publishFeedback } from "../src/visibility.ts"
import { FLOW_SUBCOMMANDS, setupTui } from "../src/tui.ts"

test("v0.3.3: FLOW_SUBCOMMANDS documenta todos los subcomandos principales", () => {
  const names = FLOW_SUBCOMMANDS.map((s) => s.subcommand)
  for (const expected of ["start", "status", "map", "gate", "next", "back", "rename", "resume", "off", "help"]) {
    assert.ok(names.includes(expected), `falta subcomando ${expected}`)
  }
})

test("v0.3.3: publishFeedback pinta toast y dialog en TUI sin escribir en instructions.entry (P3)", async () => {
  let entryPuts = 0
  const toasts: Array<{ title?: string; message: string }> = []
  const dialogs: Array<{ title: string; message: string }> = []
  const registeredCommands: Array<{ id?: string; title?: string; description?: string }> = []

  const dispose = setupTui({
    keymap: {
      layer: (factory) => {
        const layer = factory()
        registeredCommands.push(...(layer.commands ?? []))
      },
    },
    ui: {
      toast: {
        show: (opts) => { toasts.push(opts) },
      },
      dialog: {
        alert: async (opts) => { dialogs.push(opts) },
      },
    },
  })

  assert.ok(registeredCommands.length >= 11, "debe registrar /flow y sus 10 subcomandos")

  const session = {
    instructions: {
      entry: {
        put: async () => { entryPuts += 1 },
      },
    },
  }

  await publishFeedback(session, "ses_1", {
    kind: "status",
    title: "opencode-flow · Fase 1",
    message: "[flow] fase 1 · activo",
    variant: "info",
    display: "toast",
  })

  assert.equal(toasts.length, 1)
  assert.equal(toasts[0]?.title, "opencode-flow · Fase 1")
  assert.equal(entryPuts, 0, "publishFeedback no debe tocar instructions.entry")

  await publishFeedback(session, "ses_1", {
    kind: "map",
    title: "opencode-flow · Mapa",
    message: "| 1 | Entender |",
    variant: "info",
    display: "dialog",
  })

  assert.equal(dialogs.length, 1)
  assert.equal(dialogs[0]?.title, "opencode-flow · Mapa")
  assert.equal(entryPuts, 0, "map/help tampoco deben tocar instructions.entry")

  dispose()
})
