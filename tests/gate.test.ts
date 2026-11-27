import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { satisfied, verdictFor, writeTarget, type GateOptions } from "../src/gate.ts"
import { parseCommand } from "../src/phases.ts"

function project(): string {
  return mkdtempSync(join(tmpdir(), "flow-gate-"))
}

function write(root: string, relative: string, content = "contenido\n"): string {
  const absolute = join(root, relative)
  mkdirSync(join(absolute, ".."), { recursive: true })
  writeFileSync(absolute, content)
  return absolute
}

const FEATURE = "auth"

function opts(root: string, fase: number, extra: Partial<GateOptions> = {}): GateOptions {
  return { projectRoot: root, fase, feature: FEATURE, ...extra }
}

function writeTo(root: string, relative: string) {
  return writeTarget("write", { filePath: join(root, relative) }, root)
}

// ---- A10: satisfies rejects empty/placeholder artifacts ---------------------

test("A10: un spec.md VACIO no satisface el gate", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/spec.md`, "   \n\n")
  assert.equal(satisfied(5, FEATURE, root), false)
})

test("A10: un spec.md con contenido satisface el gate", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/spec.md`, "# Spec\n\nAlgo.\n")
  assert.equal(satisfied(5, FEATURE, root), true)
})

test("A10: issues/ sólo con README.md NO satisface", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/issues/README.md`)
  assert.equal(satisfied(6, FEATURE, root), false)
})

test("A10: issues/ con un ticket vacío NO satisface", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/issues/001-ticket.md`, "  \n")
  assert.equal(satisfied(6, FEATURE, root), false)
})

test("A10: issues/ con un ticket oculto NO satisface", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/issues/.001.md`)
  assert.equal(satisfied(6, FEATURE, root), false)
})

test("A10: issues/ con un ticket real satisface", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/issues/001-ticket.md`, "# Ticket\n\nContenido.\n")
  assert.equal(satisfied(6, FEATURE, root), true)
})

// ---- Gate B: phases 1-6 whitelist ------------------------------------------

test("B: fase 1 permite escribir understanding.md dentro de .scratch/<feature>/", () => {
  const root = project()
  const target = writeTo(root, `.scratch/${FEATURE}/understanding.md`)
  assert.equal(verdictFor(opts(root, 1), target).allow, true)
})

test("B: fase 3 permite design.md dentro de .scratch/<feature>/", () => {
  const root = project()
  const target = writeTo(root, `.scratch/${FEATURE}/design.md`)
  assert.equal(verdictFor(opts(root, 3), target).allow, true)
})

test("B: fase 1 BLOQUEA escribir código del proyecto (src/index.ts)", () => {
  const root = project()
  const target = writeTo(root, "src/index.ts")
  const verdict = verdictFor(opts(root, 1), target)
  assert.equal(verdict.allow, false)
})

test("B: fase 5 permite escribir el spec dentro de .scratch/", () => {
  const root = project()
  const target = writeTo(root, `.scratch/${FEATURE}/spec.md`)
  assert.equal(verdictFor(opts(root, 5), target).allow, true)
})

test("B: fase 4 permite escribir en /tmp/opencode-proto-<feature>", () => {
  const root = project()
  const proto = join(tmpdir(), `opencode-proto-${FEATURE}`, "x.js")
  const target = writeTarget("write", { filePath: proto }, root)
  assert.equal(verdictFor(opts(root, 4), target).allow, true)
})

test("B: CONTEXT.md en fase 2 sólo se permite si consta en allow", () => {
  const root = project()
  const target = writeTo(root, "CONTEXT.md")
  assert.equal(verdictFor(opts(root, 2, { allow: ["CONTEXT.md"] }), target).allow, true)
  assert.equal(verdictFor(opts(root, 2, { allow: [] }), target).allow, false)
})

test("B: docs/adr/** en fase 3 se permite si allow incluye docs/adr", () => {
  const root = project()
  const target = writeTo(root, "docs/adr/0001-decision.md")
  assert.equal(verdictFor(opts(root, 3, { allow: ["docs/adr"] }), target).allow, true)
})

test("B: CONTEXT.md en fase 4 ya NO se permite (allow sólo cuenta en fases 2-3)", () => {
  const root = project()
  const target = writeTo(root, "CONTEXT.md")
  assert.equal(verdictFor(opts(root, 4, { allow: ["CONTEXT.md"] }), target).allow, false)
})

// ---- Gate B: phases >= 7 require spec (and tickets for 7) -------------------

test("B: fase 7 bloquea código si falta el spec", () => {
  const root = project()
  const target = writeTo(root, "src/index.ts")
  assert.equal(verdictFor(opts(root, 7), target).allow, false)
})

test("B: fase 7 bloquea código si hay spec pero faltan tickets", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/spec.md`, "# Spec\n")
  const target = writeTo(root, "src/index.ts")
  assert.equal(verdictFor(opts(root, 7), target).allow, false)
})

test("B: fase 7 permite código con spec y tickets", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/spec.md`, "# Spec\n")
  write(root, `.scratch/${FEATURE}/issues/001.md`, "# Ticket\n")
  const target = writeTo(root, "src/index.ts")
  assert.equal(verdictFor(opts(root, 7), target).allow, true)
})

test("B: fase 8 permite código con spec (los tickets ya no hacen falta)", () => {
  const root = project()
  write(root, `.scratch/${FEATURE}/spec.md`, "# Spec\n")
  const target = writeTo(root, "src/index.ts")
  assert.equal(verdictFor(opts(root, 8), target).allow, true)
})

test("B: fase 7 sin spec permite aún escribir el spec en .scratch/", () => {
  const root = project()
  const target = writeTo(root, `.scratch/${FEATURE}/spec.md`)
  assert.equal(verdictFor(opts(root, 7), target).allow, true)
})

// ---- A10: path safety --------------------------------------------------------

test("A10: patch todo-o-nada sobre el whitelist", () => {
  const root = project()
  const patch = [
    `*** Update File: .scratch/${FEATURE}/understanding.md`,
    "@@",
    "x",
  ].join("\n")
  const ok = writeTarget("patch", { patchText: patch }, root)
  assert.equal(verdictFor(opts(root, 1), ok).allow, true)

  const mixed = [
    `*** Update File: .scratch/${FEATURE}/understanding.md`,
    "@@",
    "x",
    "*** Update File: src/index.ts",
    "@@",
    "y",
  ].join("\n")
  const bad = writeTarget("patch", { patchText: mixed }, root)
  assert.equal(verdictFor(opts(root, 1), bad).allow, false)
})

test("A10: un destino con .. que escapa del proyecto se bloquea", () => {
  const root = project()
  const target = writeTo(root, "../../etc/passwd")
  assert.equal(verdictFor(opts(root, 7, { allow: [] }), target).allow, false)
})

test("A10: un symlink que escapa del proyecto se bloquea", () => {
  const root = project()
  const outside = mkdtempSync(join(tmpdir(), "flow-outside-"))
  const link = join(root, "src")
  mkdirSync(link, { recursive: true })
  rmSync(link, { recursive: true, force: true })
  symlinkSync(outside, link)
  const target = writeTarget("write", { filePath: join(root, "src", "evil.ts") }, root)
  const verdict = verdictFor(opts(root, 7, { allow: [] }), target)
  assert.equal(verdict.allow, false)
})

// ---- A10: parseCommand slug validation ---------------------------------------

test("A10: parseCommand rechaza slug con ../, / o \\\\", () => {
  for (const slug of ["../evil", "a/b", "a\\\\b", ".", ".."]) {
    const parsed = parseCommand(`start 1 ${slug}`)
    assert.notEqual(parsed.kind, "start", `slug "${slug}" debe rechazarse`)
  }
})

test("A10: parseCommand rechaza slug vacío y de longitud absurda", () => {
  const parsed = parseCommand(`start 1 ${"a".repeat(80)}`)
  assert.notEqual(parsed.kind, "start")
})

test("A10: parseCommand rechaza fase 0 y 11 con error claro", () => {
  const zero = parseCommand("start 0")
  const eleven = parseCommand("start 11")
  assert.equal(zero.kind, "help")
  assert.equal(eleven.kind, "help")
})
