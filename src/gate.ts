// The write gate: sin spec no hay código. Filesystem checks only — no guessing from names.
//
// Rule: this module never lets a write through when it cannot tell what is being written.

import { readdirSync, statSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
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
}

/** Phases whose gate is file-verifiable. Everything else is declarative (user closes it by hand). */
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

// Phase 5 wants a file; phase 6 wants a directory holding at least one ticket.
function satisfies(entry: ReturnType<typeof phase>, absolute: string, feature: string): boolean {
  const spec = entry?.artifact?.(feature)
  if (!spec) return false
  try {
    const info = statSync(absolute)
    if (spec.file) return info.isFile()
    if (spec.dir) {
      if (!info.isDirectory()) return false
      return readdirSync(absolute, { withFileTypes: true }).some(
        (child) => child.isFile() && child.name.toLowerCase().endsWith(".md"),
      )
    }
  } catch {
    return false
  }
  return false
}

/**
 * Decide whether a write attempt is allowed.
 * Conservative on purpose: if we cannot name the target, we block and say why.
 */
export function verdictFor(options: GateOptions, target: WriteTarget): GateVerdict {
  const entry = phase(options.fase)
  if (!entry || !blocking(entry)) return { allow: true, reason: `fase ${options.fase}: gate declarativo` }

  const relatives = artifactPaths(options.feature, entry)
  // No feature declared: the gate stays disarmed rather than blocking everything.
  if (!relatives) {
    return { allow: true, reason: "gate inactivo: falta declarar feature (/flow start N <slug>)" }
  }

  const absolutes = relatives.map((name) => resolveAgainst(options.projectRoot, name))
  const done = absolutes.some((absolute) => satisfies(entry, absolute, options.feature ?? ""))
  if (done) return { allow: true, reason: `artefacto presente: ${relatives.join(" | ")}` }

  // Unparseable target: block. A gate that silently lets through is worse than one that nags.
  if (target.kind === "unknown") {
    return { allow: false, reason: `no pude determinar el archivo destino (${target.tool}); bloqueo por seguridad` }
  }

  // `patch` is all-or-nothing: creating the spec while touching project code is not allowed.
  if (target.kind === "patch") {
    const inside = target.files.filter((file) =>
      absolutes.some((absolute) => file === absolute || file.startsWith(`${absolute}/`)),
    )
    const allowed = inside.length > 0 && inside.length === target.files.length
    if (allowed) return { allow: true, reason: "patch afecta sólo al artefacto" }
    return {
      allow: false,
      reason:
        target.files.length === 0
          ? "patch sin archivos parseables; bloqueo por seguridad"
          : `patch toca ${target.files.length} archivo(s) y no todos son el artefacto exigido`,
    }
  }

  const inside = absolutes.some((absolute) => target.file === absolute || target.file.startsWith(`${absolute}/`))
  if (inside) return { allow: true, reason: "escritura sobre el artefacto" }

  return {
    allow: false,
    reason: `fase ${entry.n} (${entry.name}) exige ${relatives.join(" | ")}; falta. Escríbelo, o /flow gate ${entry.gate}, o /flow off`,
  }
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
    if (typeof value === "string" && value.trim()) found.push(value.trim())
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
  if (paths.length > 0) return { kind: "file", file: resolveAgainst(base, paths[0]), tool }
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
    .some((absolute) => satisfies(entry, absolute, feature))
}

/** Explain the gate of the current phase, for `/flow status` and the start brief. */
export function gateRequirement(fase: number, feature: string | undefined, root: string): string | undefined {
  const entry = phase(fase)
  if (!entry || !blocking(entry)) return undefined
  const relatives = artifactPaths(feature, entry)
  if (!relatives) return `gate ${entry.gate}: inactivo hasta declarar feature`
  const absolutes = relatives.map((name) => resolveAgainst(root, name))
  const done = absolutes.some((absolute) => satisfies(entry, absolute, feature ?? ""))
  return `gate ${entry.gate}: ${done ? "satisfecho" : "falta"} ${relatives.join(" | ")}`
}

export const gateVersion = 1
