# FLOW — contrato de trabajo

Reglas no negociables, activas en cada petición. Si una petición del usuario las contradice, dilo antes de continuar.

## Mapa de fases (orden prescriptivo)

| # | Fase | Skill | Cierra con |
|---|------|-------|------------|
| 1 | Entender | `grilling` | checkpoint de entendimiento aprobado |
| 2 | Vocabulario | `domain-modeling` | términos y ADR acordados |
| 3 | Diseño del módulo | `codebase-design` | costuras y tests definidos |
| 4 | Sondear | `prototype` | respuesta a una pregunta de diseño |
| 5 | Especificar | `to-spec` | `.scratch/<feature>/spec.md` |
| 6 | Trocear | `to-tickets` | tickets verticales con bloqueos |
| 7 | Implementar | `implement-spec` (con tickets) o `tdd` (sin tickets; siempre en proyectos sin git) | tests en verde |
| 8 | Revisar | `code-review` contra el spec | hallazgos resueltos |
| 9 | Publicar | `pr` | PR con evidencia |
| 10 | Cerrar | `retro` | lecciones registradas |

En fondo: `research` (fuentes primarias). `wait-what` cuando algo no cierra. `handoff` para escalar.
Saltar una fase exige decir qué riesgo se asume y obtener aceptación explícita del usuario.

## Tres gates

1. **Sin spec no hay código.** Salvo fase 4 (`prototype`, desechable). Cambio trivial: excepción declarada y aceptada.
2. **Sin evidencia no hay afirmación.** Nunca digas "funciona", "listo", "arreglado" ni "tests pasan" sin haber corrido el comando en esta sesión y leído la salida completa.
3. **Sin decisión de integración no hay cierre.** Antes de cerrar: cómo se integra (commit, PR, merge) y qué queda pendiente.

## Dónde se escribe

- **Fases 1-6:** sólo en `.scratch/<feature>/**`; en la fase 4 también en `/tmp/opencode-proto-<feature>/**`.
- **Fases 2-3,** y sólo si ya existían al ejecutar `/flow start`: `CONTEXT.md` y `docs/adr/**`.
- **Fase 7 en adelante:** código del proyecto, con `.scratch/<feature>/spec.md` escrito (y tickets en la fase 7).
- El gate bloquea en el runtime. Si te bloquea, no rodees: escribe el artefacto que falta.

## Checkpoint (entregable de Plan)

Antes de editar código, entrega exactamente:

- **Entendí**: qué se pide, con citas `path:line`.
- **Asumo**: lo no dicho que estoy completando.
- **Necesito que confirmes**: preguntas abiertas reales.

Pasar a build es la aprobación. No repitas el checkpoint después.

## Narración obligatoria

En cada transición de fase y antes de cualquier afirmación de avance o de terminado, escribe una línea:

`[flow] fase N · gate pendiente: X`

Sin esa línea el estado no sobrevive a la compactación.

## Verificación (escalera)

1. Detecta el manifest (`package.json`, `requirements.txt`, etc.) del directorio que vas a tocar.
2. Localiza el script real en ese manifest; no inventes comandos.
3. Ejecuta desde el directorio correcto (la raíz de un monorepo puede no tener manifest).
4. Lee la salida completa, incluido el código de salida.
5. Sólo entonces afirma. Si falló, pega el error real.

Si el manifest no declara suite: dilo en vez de inventar un comando, y verifica con lo que sí se pueda ejecutar.

## Escaladas

- `handoff`: cuando el problema excede el modelo actual; lleva evidencia (comandos, salidas, archivos).
- `research`: en segundo plano cuando falta un dato externo verificable.
- `wait-what`: cuando la premisa o el pedido no cierra; parar y preguntar.

## Trigger y gate (plugin `opencode-flow`)

El contrato activo es este archivo en disco: cada petición con flow activo recibe el bloque común
y la sección de la fase actual.

- `/flow start [N] [slug]` — activa el flow y declara la feature. Sin slug el gate de escritura queda inactivo.
- `/flow status` — fase, gate, feature y ruta del spec.
- `/flow gate <spec|tickets|evidence|review|integration|retro>` — cierra el gate y avanza de fase.
- `/flow off` — escapatoria; desactiva todo.
- `/workflow …` — alias.

Tres reglas de uso:

1. **Silencio mientras está inactivo.** Con el flow apagado el plugin no inyecta nada: ni recordatorio ni
   contrato. Es opt-in y se mantiene invisible hasta que el usuario escribe `/flow`.
2. **Silencio en cada turno.** El flow es conversacional: se guía pidiendo, no inyectando avisos.
3. **Auto-avance por artefacto.** Si el flow está activo en fase 5 y ya existe `.scratch/<feature>/spec.md`,
   o en fase 6 y ya hay algún `*.md` en `.scratch/<feature>/issues/`, la fase avanza sola: no hace falta
   `/flow gate spec|tickets`. Las fases 7-10 son declarativas y no auto-avanzan.

El gate sólo intercepta herramientas de escritura (`write`, `edit`, `patch`, `multiedit`, `apply_patch`):
leer, buscar y ejecutar comandos quedan fuera de su alcance. Bloquea cuando hay feature declarada y falta el artefacto:

- fase 5 → exige `.scratch/<feature>/spec.md`
- fase 6 → exige tickets `*.md` en `.scratch/<feature>/issues`
- fase 1-4 y 7-10 → declarativas: el gate se cierra a mano

`patch` es todo-o-nada: se permite únicamente si **todos** los archivos del `patchText` son el artefacto
exigido. Si además toca código del proyecto, o si no se puede parsear, bloquea. Escribir el propio artefacto
siempre está permitido.

Si el runtime no expone hooks de herramientas, el gate se desarma y lo dice al arrancar: nunca rompe la sesión.

Las secciones y la tabla de arriba son la fuente de verdad en prosa; `src/phases.ts` guarda sólo los datos
estructurales. Un test de coherencia falla si divergen: si cambias una, cambia la otra.

## Fase 1 — Entender

- Skill: `grilling`
- Gate: ninguno
- Cierra con: checkpoint de entendimiento aprobado

## Fase 2 — Vocabulario

- Skill: `domain-modeling`
- Gate: ninguno
- Cierra con: términos y ADR acordados

## Fase 3 — Diseño del módulo

- Skill: `codebase-design`
- Gate: ninguno
- Cierra con: costuras y tests definidos

## Fase 4 — Sondear

- Skill: `prototype`
- Gate: ninguno
- Cierra con: respuesta a una pregunta de diseño

Escribe sólo en `/tmp/opencode-proto-<slug>`. Nunca dentro del árbol del proyecto. Es desechable: no se commitea.

## Fase 5 — Especificar

- Skill: `to-spec`
- Gate: `spec`
- Cierra con: `.scratch/<feature>/spec.md`
- Artefacto: `.scratch/<feature>/spec.md`

No exijas las fases 1-4 para arrancar aquí: si la conversación ya trae el problema, sintetízalo ahora mismo.
Escribe el spec ya en `.scratch/<feature>/spec.md` con lo que hayas entendido (problema, alcance, fuera de
alcance, criterios de aceptación). No te bloquees esperando datos que falten: escribe con lo que hay y marca
los supuestos. Sigue en loop con el usuario hasta que apruebe; el gate se abre solo cuando el archivo exista.

## Fase 6 — Trocear

- Skill: `to-tickets`
- Gate: `tickets`
- Cierra con: tickets verticales con bloqueos
- Artefacto: tickets `*.md` en `.scratch/<feature>/issues`

## Fase 7 — Implementar

- Skill: `implement-spec (con tickets) o tdd (sin tickets; siempre en proyectos sin git)`
- Gate: `evidence`
- Cierra con: tests en verde

## Fase 8 — Revisar

- Skill: `code-review` contra el spec
- Gate: `review`
- Cierra con: hallazgos resueltos

## Fase 9 — Publicar

- Skill: `pr`
- Gate: `integration`
- Cierra con: PR con evidencia

## Fase 10 — Cerrar

- Skill: `retro`
- Gate: `retro`
- Cierra con: lecciones registradas
