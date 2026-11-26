import { test } from "node:test"
import assert from "node:assert/strict"
import { makeLogger, OnceLog, type Logger } from "../src/log.ts"

function recorder() {
  const lines: string[] = []
  const logger: Logger = {
    error: (message, extra) => lines.push(`ERROR ${message}${extra !== undefined ? " " + String(extra) : ""}`),
    debug: (message) => lines.push(`DEBUG ${message}`),
  }
  return { lines, logger }
}

test("A0: usa ctx.logger si existe", () => {
  const { lines, logger } = recorder()
  const logger1 = makeLogger({ logger })
  logger1.error(" boom")
  assert.equal(lines.length, 1)
  assert.match(lines[0], /ERROR/)
})

test("A0: usa ctx.client.app.log si no hay ctx.logger", () => {
  const { lines, logger } = recorder()
  makeLogger({ client: { app: { log: logger } } }).error(" boom")
  assert.equal(lines.length, 1)
})

test("A0: prefiere ctx.logger sobre client.app.log", () => {
  const first = recorder()
  const second = recorder()
  makeLogger({ logger: first.logger, client: { app: { log: second.logger } } }).error(" x")
  assert.equal(first.lines.length, 1)
  assert.equal(second.lines.length, 0)
})

test("A0: cae a consola si no hay logger en el runtime", () => {
  const original = console.error
  const captured: string[] = []
  console.error = (...args: unknown[]) => captured.push(args.join(" "))
  try {
    makeLogger({}).error(" hola")
  } finally {
    console.error = original
  }
  assert.equal(captured.length, 1)
  assert.match(captured[0], /hola/)
})

test("A1/A4: cada fallo se registra UNA vez, no en cada turno", () => {
  const { lines, logger } = recorder()
  const once = new OnceLog(logger)
  for (let i = 0; i < 50; i++) once.error("storage", "sin storage")
  assert.equal(lines.length, 1)
})

test("A1/A4: claves distintas se registran", () => {
  const { lines, logger } = recorder()
  const once = new OnceLog(logger)
  once.error("storage", "sin storage")
  once.error("hook", "sin tool.hook")
  assert.equal(lines.length, 2)
})

test("A1/A4: has() refleja lo ya registrado", () => {
  const { logger } = recorder()
  const once = new OnceLog(logger)
  assert.equal(once.has("x"), false)
  once.error("x", "mensaje")
  assert.equal(once.has("x"), true)
})

test("A1/A4: debug se omite si el runtime no tiene nivel debug", () => {
  const lines: string[] = []
  const once = new OnceLog({ error: (m) => lines.push(m) })
  assert.equal(once.debug("k", "mensaje debug"), false)
  assert.equal(lines.length, 0)
})

test("A1/A4: el prefijo identifica el plugin", () => {
  const { lines, logger } = recorder()
  new OnceLog(logger, "[PREFIX]").error("k", "fallo")
  assert.match(lines[0], /\[PREFIX\] fallo/)
})
