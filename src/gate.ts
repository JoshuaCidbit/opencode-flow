// The write gate: sin spec no hay código. Filesystem checks only — no guessing from names.
//
// Rule: this module never lets a write through when it cannot tell what is being written.
//
// Gate B (fases 1-6): whitelist. Sólo se escribe en `.scratch/<feature>/**`, en el proto
// `/tmp/opencode-proto-<feature>/**`, y —sólo en fases 2-3 y sólo si existían al ejecutar
// `/flow start`— en `CONTEXT.md` y `docs/adr/**`. Fase >= 7: se escribe código del proyecto
// sólo con el spec presente (y con tickets, además, en la fase 7).

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { phase } from "./phases.ts"

export type GateVerdict =
  | { allow: true; reason: string }
  | { allow: false; reason: string }

export type GateOptions = {
  /** Project root used to resolve `.scratch/<feature>/…`. */
  readonly projectRoot: string
  /** Phase number currently persisted in storage. */
  readonly fase: number
  readonly feature?: string
  /**
   * Rutas (relativas al proyecto) que EXISTÍAN al ejecutar `/flow start`. Gate B las permite
   * en fases 2-3: `CONTEXT.md` y `docs/adr` si estaban allí. Fuera de 2-3 no cuentan.
   */
  readonly allow?: string[]
}

/** Phases whose gate is file-verifiable and block auto-advance. */
function blocking(entry: ReturnType<typeof phase>): boolean {
  return Boolean(entry?.blocks && entry.artifact)
}

/**
 * Resolve the artifact the active gate demands.
 * `undefined` means "no artifact to check": either there is no phase, or no feature was declared.
 */
export function artifactPaths(feature: string | undefined, entry: ReturnType<typeof phase>): string[] | undefined {
  const spec = entry?.artifact?.(feature ?? "")
  if (!feature || !spec) return undefined
  const names: string[] = []
  if (spec.file) names.push(spec.file)
  if (spec.dir) names.push(spec.dir)
  return names.length > 0 ? names : undefined
}

function resolveAgainst(base: string, candidate: string): string {
  return isAbsolute(candidate) ? candidate : resolve(base, candidate)
}

// ---- A10: contención real (normaliza `..` y sigue symlinks) -----------------

/** Resuelve el camino real aunque el destino no exista todavía (realpath del ancestro + cola). */
function canonical(path: string): string | undefined {
  let cursor = path
  const tail: string[] = []
  for (let depth = 0; depth < 128; depth++) {
    try {
      const real = realpathSync(cursor)
      return tail.length > 0 ? join(real, ...tail) : real
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) return undefined
      tail.unshift(basename(cursor))
      cursor = parent
    }
  }
  return undefined
}

/** `child` está dentro de `parent` (comparando caminos reales, para no seguir symlinks fuera). */
function safeWithin(parent: string, child: string): boolean {
  const realParent = canonical(parent)
  const realChild = canonical(child)
  if (!realParent || !realChild) return false
  const rel = relative(realParent, realChild)
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

function isNonEmptyFile(absolute: string): boolean {
  try {
    const info = statSync(absolute)
    if (!info.isFile() || info.size === 0) return false
    return readFileSync(absolute, "utf8").trim().length > 0
  } catch {
    return false
  }
}

// A10: un artefacto vacío, oculto o de relleno no cierra el gate.
function isRealTicket(absolute: string, name: string): boolean {
  if (name.startsWith(".")) return false
  if (name.toLowerCase() === "readme.md") return false
  if (!name.toLowerCase().endsWith(".md")) return false
  return isNonEmptyFile(join(absolute, name))
}

// Phase 5 wants a file; phase 6 wants a directory holding at least one real ticket.
function satisfiesArtifact(entry: ReturnType<typeof phase>, absolute: string, feature: string): boolean {
  const spec = entry?.artifact?.(feature)
  if (!spec) return false
  try {
    const info = statSync(absolute)
    if (spec.file) return isNonEmptyFile(absolute)
    if (spec.dir) {
      if (!info.isDirectory()) return false
      return readdirSync(absolute, { withFileTypes: true }).some(
        (child) => child.isFile() && isRealTicket(absolute, child.name),
      )
    }
  } catch {
    return false
  }
  return false
}

function phaseScratch(projectRoot: string, feature: string): string {
  return join(projectRoot, ".scratch", feature)
}

function phaseProto(feature: string): string {
  return join(tmpdir(), `opencode-proto-${feature}`)
}

/** Formatea una negativa sin nombrar rutas internas innecesarias. */
function refuse(reason: string): GateVerdict {
  return { allow: false, reason }
}

/**
 * Decide whether a write attempt is allowed.
 * Conservative on purpose: if we cannot name the target, we block and say why.
 */
export function verdictFor(options: GateOptions, target: WriteTarget): GateVerdict {
  const entry = phase(options.fase)
  if (!entry) return { allow: true, reason: `fase ${options.fase}: sin gate (desconocida)` }

  // No feature declared: the gate stays disarmed rather than blocking everything.
  if (!options.feature) {
    return { allow: true, reason: "gate inactivo: falta declarar feature (/flow start N <slug>)" }
  }

  // Unparseable target: block. A gate that silently lets through is worse than one that nags.
  if (target.kind === "unknown") {
    return refuse(`no pude determinar el archivo destino (${target.tool}); bloqueo por seguridad`)
  }

  const targets = target.kind === "patch" ? target.files : [target.file]
  if (targets.length === 0) {
    return refuse("patch sin archivos parseables; bloqueo por seguridad")
  }

  const feature = options.feature
  const scratch = phaseScratch(options.projectRoot, feature)
  const proto = phaseProto(feature)
  const extras = options.fase === 2 || options.fase === 3 ? (options.allow ?? []) : []

  const permitted = (candidate: string): boolean => {
    if (safeWithin(scratch, candidate)) return true
    if (safeWithin(proto, candidate)) return true
    return extras.some((allowed) => safeWithin(resolve(options.projectRoot, allowed), candidate))
  }

  // A10: contención. Si escapa del proyecto y del proto, fuera — aunque el whitelist dijera sí.
  for (const candidate of targets) {
    if (!safeWithin(options.projectRoot, candidate) && !safeWithin(proto, candidate)) {
      return refuse(`destino fuera del proyecto y fuera del proto: ${candidate}; bloqueo por seguridad`)
    }
  }

  const allPermitted = targets.every(permitted)

  // Fase >= 7: código del proyecto exige spec (y tickets, además, en la fase 7).
  if (options.fase >= 7) {
    const specReady = satisfied(5, feature, options.projectRoot)
    const ticketsReady = options.fase !== 7 || satisfied(6, feature, options.projectRoot)
    if (specReady && ticketsReady) return { allow: true, reason: "spec presente: escritura del proyecto permitida" }
    // Aún sin spec: deja escribir dentro de .scratch/ para que se pueda crear el artefacto.
    if (allPermitted) return { allow: true, reason: "escritura dentro de .scratch/ antes de cerrar el gate" }
    const falta = `${specReady ? "" : "spec"}${!specReady && !ticketsReady ? " y tickets" : ""}`.trim()
    return refuse(`fase ${entry.n} (${entry.name}) exige ${falta}; escríbelo en .scratch/${feature}/`)
  }

  // Fases 1-6: whitelist.
  if (allPermitted) {
    const why = targets.every((candidate) => safeWithin(scratch, candidate))
      ? `escritura dentro de .scratch/${feature}/`
      : `escritura en zona permitida por el contrato (fase ${entry.n})`
    return { allow: true, reason: why }
  }

  return refuse(
    `fase ${entry.n} (${entry.name}) sólo permite escribir en .scratch/${feature}/` +
      (options.fase === 4 ? ` y ${proto}/` : "") +
      (extras.length > 0 ? `, y en ${extras.join(", ")}` : "") +
      ". El código del proyecto se escribe a partir de la fase 7, con spec.",
  )
}

export type WriteTarget =
  | { kind: "file"; file: string; tool: string }
  | { kind: "patch"; files: string[]; tool: string }
  | { kind: "unknown"; tool: string }

// `edit`/`write` carry the destination in a path field. Accept the shapes actually seen at runtime.
const PATH_FIELDS = ["filePath", "file_path", "path", "filename", "fileName"] as const

function readPathFields(input: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const field of PATH_FIELDS) {
    const value = input[field]
    if (typeof value === "string" && value.trim()) found.push(resolveAgainst(".", value.trim()))
  }
  return found
}

/**
 * Extract every `*** Update File: <name>` / `*** Add File: <name>` header from a unified patch.
 * Anything else that looks like a file line is ignored on purpose.
 */
export function patchFiles(patchText: string): string[] {
  const files: string[] = []
  const re = /^\s*\*{3}\s+(?:Update|Add|Delete)\s+File:\s*(.+?)\s*$/gim
  for (const match of patchText.matchAll(re)) {
    const name = match[1]?.trim()
    if (name) files.push(name)
  }
  return files
}

/** Normalise an arbitrary tool call into something the gate can judge. */
export function writeTarget(tool: string, input: unknown, base: string): WriteTarget {
  if (!input || typeof input !== "object") return { kind: "unknown", tool }
  const record = input as Record<string, unknown>

  const patchText = record.patchText
  if (typeof patchText === "string" && patchText.trim()) {
    const files = patchFiles(patchText)
    if (files.length === 0) return { kind: "unknown", tool }
    return { kind: "patch", files: files.map((file) => resolveAgainst(base, file)), tool }
  }

  const paths = readPathFields(record)
  if (paths.length > 0) {
    // A10: normaliza relativo contra el proyecto y absoluto tal cual.
    return { kind: "file", file: resolveAgainst(base, paths[0]), tool }
  }
  return { kind: "unknown", tool }
}

/**
 * True when the artifact that closes `fase` already exists on disk.
 * Used by the auto-advance: seeing the artifact is the user's act; no manual gate needed.
 */
export function satisfied(fase: number, feature: string | undefined, root: string): boolean {
  const entry = phase(fase)
  if (!feature || !blocking(entry)) return false
  const relatives = artifactPaths(feature, entry)
  if (!relatives) return false
  return relatives
    .map((name) => resolveAgainst(root, name))
    .some((absolute) => satisfiesArtifact(entry, absolute, feature))
}

/** Explain the gate of the current phase, for `/flow status` and the start brief. */
export function gateRequirement(fase: number, feature: string | undefined, root: string): string | undefined {
  const entry = phase(fase)
  if (!entry) return undefined
  if (!feature) return `gate ${entry.gate ?? "ninguno"}: inactivo hasta declarar feature`

  if (fase >= 7) {
    const spec = satisfied(5, feature, root)
    const tickets = fase !== 7 || satisfied(6, feature, root)
    return `gate de escritura: ${spec && tickets ? "abierto (spec" + (fase === 7 ? " + tickets" : "") + " presente)" : "cerrado (falta " + (spec ? "tickets" : "spec") + ")"}`
  }
  return `gate de escritura: whitelist .scratch/${feature}/` + (fase === 4 ? " + proto" : "") + (fase === 2 || fase === 3 ? " (+ CONTEXT.md/docs/adr si existían al start)" : "")
}

export const gateVersion = 2
