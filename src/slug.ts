// Slug de la feature: raíz de los artefactos en .scratch/<slug>/.
//
// Reglas (decisión C1):
//   - `/flow <descripción>`: slug definitivo, derivado de la descripción.
//   - `/flow` sin argumentos: slug provisional `flow-` + los ÚLTIMOS 6 caracteres del
//     sessionID (sin el prefijo `ses_`), marcado con slugProvisional: true.
// Por qué el provisional usa el sessionID y no el título de sesión: medido en 2.4.2, ni
// ctx.session.get ni session.list devuelven `title` en sesiones nuevas. Verificado en sonda A7.

/** Longitud máxima de un slug de feature (compartida por slugify, isValidSlug y el presupuesto del contrato). */
export const MAX_SLUG = 60

/** Longitud del sufijo provisional tomado del sessionID. */
export const PROVISIONAL_SUFFIX_LENGTH = 6

const PROVISIONAL_PREFIX = "flow-"

// Nombres reservados de Windows: no pueden usarse como nombre de fichero/directorio.
// Como .scratch/<slug>/ se crea en disco, un slug así rompería en Windows.
const RESERVED_WINDOWS = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
])
const RESERVED_PREFIX = "x-"

function baseSlug(description: string): string {
  return description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos: "módulo" -> "modulo"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "")
}

/** Forma canónica de un slug de feature: minúsculas, dígitos y guiones, 1-MAX_SLUG caracteres. */
const SLUG_RE = new RegExp(`^[a-z0-9-]{1,${MAX_SLUG}}$`)

/** `true` si el valor puede usarse tal cual como nombre de feature (no normaliza, valida). */
export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value) && !value.includes("--") && !value.startsWith("-") && !value.endsWith("-")
}

/**
 * Convierte texto libre en un slug kebab-case válido para usar como nombre de directorio.
 * Devuelve undefined si tras normalizar no queda ningún carácter válido (emojis, símbolos,
 * alfabetos no latinos): el llamador debe caer al slug provisional, nunca usar "".
 */
export function slugify(description: string): string | undefined {
  const slug = baseSlug(description)
  if (slug.length === 0) return undefined
  // Se prefija el nombre reservado en vez de rechazarlo: el usuario pidió esa palabra.
  return RESERVED_WINDOWS.has(slug) ? `${RESERVED_PREFIX}${slug}` : slug
}

/**
 * Slug provisional derivado del sessionID.
 * El sessionID siempre existe; si no quedaran caracteres válidos cae a "local".
 */
export function provisionalSlug(sessionID: string): string {
  const tail = sessionID.replace(/^ses_/i, "")
  const alnum = tail.replace(/[^0-9a-z]/gi, "").toLowerCase()
  const suffix = alnum.slice(-PROVISIONAL_SUFFIX_LENGTH) || "local"
  return `${PROVISIONAL_PREFIX}${suffix}`
}
