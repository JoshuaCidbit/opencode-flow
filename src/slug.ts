// Slug de la feature: raíz de los artefactos en .scratch/<slug>/.
//
// Reglas (decisión C1):
//   - `/flow <descripción>`: slug definitivo, derivado de la descripción.
//   - `/flow` sin argumentos: slug provisional `flow-` + 6 primeros caracteres del sessionID,
//     marcado con slugProvisional: true.
// Por qué el provisional usa el sessionID y no el título de sesión: medido en 2.4.2, ni
// ctx.session.get ni session.list devuelven `title` en sesiones nuevas. Verificado en sonda A7.

/** Longitud del sufijo provisional tomado del sessionID. */
export const PROVISIONAL_SUFFIX_LENGTH = 6

const PROVISIONAL_PREFIX = "flow-"

/**
 * Convierte texto libre en un slug kebab-case válido.
 * Devuelve undefined si la descripción no produce ningún carácter válido.
 */
export function slugify(description: string): string | undefined {
  const slug = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos: "módulo" -> "modulo"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60)
    .replace(/-+$/g, "")

  return slug.length > 0 ? slug : undefined
}

/**
 * Slug provisional derivado del sessionID.
 * El sessionID siempre existe, así que nunca falla; si llegara vacío, cae al prefijo solo.
 */
export function provisionalSlug(sessionID: string): string {
  const suffix = sessionID.slice(0, PROVISIONAL_SUFFIX_LENGTH)
  return `${PROVISIONAL_PREFIX}${suffix}`
}
