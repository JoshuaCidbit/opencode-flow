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

- `/flow` — activa en fase 1 con slug provisional derivado de la sesión.
- `/flow <descripción>` — activa en fase 1 con el slug derivado del texto.
- `/flow start [N] [slug]` — activa/continúa en la fase N.
- `/flow next` — avanza una fase; `/flow back [N]` retrocede N (reabre gates).
- `/flow rename <slug>` — renombra la feature; `/flow resume [slug]` reactiva un flow parado.
- `/flow status` — fase, gate, feature y ruta del spec.
- `/flow gate <spec|tickets|evidence|review|integration|retro>` — cierra el gate y avanza.
- `/flow off` — escapatoria; desactiva todo. `/workflow …` es alias.

Tres reglas de uso:

1. **Silencio mientras está inactivo.** Con el flow apagado el plugin no inyecta nada: ni recordatorio ni
   contrato. Es opt-in y se mantiene invisible hasta que el usuario escribe `/flow`.
2. **Silencio en cada turno.** El flow es conversacional: se guía pidiendo, no inyectando avisos.
3. **Auto-avance por artefacto.** Si el flow está activo en fase 5 y ya existe un `.scratch/<feature>/spec.md`
   **no vacío**, o en fase 6 y ya hay un ticket **no vacío, no oculto y no `README.md`** en
   `.scratch/<feature>/issues/`, la fase avanza sola. Las fases 7-10 son declarativas.

Gate de escritura (política de rutas, no de nombres):

- **Fases 1-6:** sólo `.scratch/<feature>/**`; en la fase 4 también `/tmp/opencode-proto-<feature>/**`.
- **Fases 2-3:** además `CONTEXT.md` y `docs/adr/**`, y sólo si ya existían al `/flow start`.
- **Fase 7 y siguientes:** código del proyecto, con `spec.md` escrito (y tickets en la fase 7). Escribir el
  artefacto dentro de `.scratch/` siempre se permite: el gate nunca es un callejón sin salida.

Un `patch` es todo-o-nada sobre el conjunto permitido. Las rutas se canonicalizan: `..` y symlinks que escapan
del proyecto se bloquean. Un artefacto vacío, oculto o llamado `README.md` no cierra el gate.

Si el runtime no expone hooks de herramientas, el gate se desarma y lo dice al arrancar: nunca rompe la sesión.

Las secciones y la tabla de arriba son la fuente de verdad en prosa; `src/phases.ts` guarda sólo los datos
estructurales. Un test de coherencia falla si divergen: si cambias una, cambia la otra.

## Fase 1 — Entender

- Skill: `grilling`
- Gate: ninguno
- Cierra con: checkpoint de entendimiento aprobado

Entrevista antes de tocar nada. Usa `grilling` para producir el **checkpoint** (Entendí / Asumo / Necesito que confirmes), con citas `path:line`. No escribas código ni abras ninguna etapa posterior hasta que el usuario apruebe ese checkpoint. Si ya lo trae en la conversación, recíbelo, confírmalo en una línea y sigue.

## Fase 2 — Vocabulario

- Skill: `domain-modeling`
- Gate: ninguno
- Cierra con: términos y ADR acordados

Fija el vocabulario antes de diseñar: `GLOSSARY.md` y ADRs. `CONTEXT.md` y `docs/adr/**` sólo se escriben si ya existían cuando se ejecutó `/flow start`; si no existían, propón el contenido en el checkpoint y deja que el usuario decida. No inventes términos que el código no usa.

## Fase 3 — Diseño del módulo

- Skill: `codebase-design`
- Gate: ninguno
- Cierra con: costuras y tests definidos

Diseña como **deep module**: interface estrecha, costura clara, tests en la costura. Entrega costuras y tests definidos, no código. Si el diseño no se sostiene, dilo antes de implementarlo.

## Fase 4 — Sondear

- Skill: `prototype`
- Gate: ninguno
- Cierra con: respuesta a una pregunta de diseño

Responde UNA pregunta de diseño con el prototipo más pequeño que baste; registra qué aprendiste y qué descartaste. Escribe sólo en `/tmp/opencode-proto-<slug>`, nunca dentro del árbol del proyecto. Es desechable: no se commitea.

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
- **Cuándo los tickets son requisito.** El gate de escritura de la fase 7 exige `spec.md` siempre,
  y tickets SÓLO si hubo compromiso (`ticketsOpted`). El compromiso se activa cuando:
  1. `/flow next` desde una fase 6 **recorrida** (no deducida al retomar): elegiste ese camino;
  2. `/flow gate tickets`: cierre explícito de esa puerta;
  3. `/flow resume` encuentra tickets ya en disco: lo escrito manda.
  Si retomas ya en 6/7 sin tickets, el estado recuerda `ticketsOpted:false` (camino `tdd`) y explicitar
  `/flow next` no los exige; si ninguno de los tres ocurrió, exigir tickets inventaría una fase 6 que
  no recorriste.

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
