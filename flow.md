# FLOW — contrato de trabajo

Reglas no negociables, activas en cada petición. Si una petición del usuario las contradice, dilo antes de continuar.

## Mapa de fases (orden prescriptivo)

| # | Fase | Skill | Cierra con |
|---|------|-------|------------|
| 1 | Entender | `grilling` | `understanding.md` aprobado por el usuario |
| 2 | Vocabulario | `domain-modeling` | `glossary.md` aprobado por el usuario |
| 3 | Diseño de módulos | `codebase-design` | `design.md` aprobado por el usuario |
| 4 | Sondear | `prototype` | respuesta a una pregunta de diseño anotada en `design.md` |
| 5 | Especificar | `to-spec` | `spec.md` |
| 6 | Trocear | `to-tickets` | tickets verticales con bloqueos |
| 7 | Implementar | `implement-spec` (con tickets) o `tdd` (sin tickets; siempre en proyectos sin git) | tests en verde |
| 8 | Revisar | `code-review` contra el spec | hallazgos resueltos |
| 9 | Publicar | `pr` | PR con evidencia |
| 10 | Cerrar | `retro` | lecciones registradas |

Los artefactos viven todos bajo `.scratch/<feature>/`, menos el prototipo de la fase 4.
Saltar una fase exige decir el riesgo que se asume. En fondo: `research`, `wait-what` y `handoff`.

## Tres gates

1. **Sin spec no hay código.** Salvo fase 4 (`prototype`, desechable). Cambio trivial: excepción declarada y aceptada.
2. **Sin evidencia no hay afirmación.** Nunca digas "funciona", "listo", "arreglado" ni "tests pasan" sin haber corrido el comando en esta sesión y leído la salida completa.
3. **Sin decisión de integración no hay cierre.** Antes de cerrar: cómo se integra (commit, PR, merge) y qué queda pendiente.

## Dónde se escribe

- **Fases 1-6:** sólo en `.scratch/<feature>/**`; en la fase 4 también en `/tmp/opencode-proto-<feature>/**`.
- **Fases 2-3,** y sólo si ya existían al ejecutar `/flow start`: `CONTEXT.md` y `docs/adr/**`.
- **Fase 7 en adelante:** código del proyecto, con `.scratch/<feature>/spec.md` escrito (y tickets solo si se optó por ellos; el camino tdd no los exige).
  Escribir el artefacto dentro de `.scratch/` siempre se permite: el gate nunca es un callejón sin salida.
- El gate bloquea en el runtime. Si te bloquea, no rodees: escribe el artefacto que falta.

## Formato del checkpoint (fase 1)

Cuando no queden dudas de diseño, entrégalo así, escríbelo en `understanding.md` y espérate:
lo aprueba el usuario con `/flow next`.

- **Entendí**: qué se pide, con citas `path:line`.
- **Asumo**: lo no dicho que estoy completando.
- **Necesito que confirmes**: preguntas abiertas reales.

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

- `/flow` — activa en fase 1 con slug provisional derivado de la sesión.
- `/flow <descripción>` — activa en fase 1 con el slug derivado del texto.
- `/flow start [N] [slug]` — activa/continúa en la fase N.
- `/flow next` — avanza una fase; `/flow back [N]` retrocede N (reabre gates).
- `/flow rename <slug>` — renombra la feature; `/flow resume [slug]` reactiva un flow parado.
- `/flow status` — fase, gate, feature y ruta del spec.
- `/flow gate <spec|tickets|evidence|review|integration|retro>` — cierra el gate y avanza.
- `/flow off` — escapatoria; desactiva todo. `/workflow …` es alias.

Dos reglas de uso:

1. **Auto-avance por artefacto.** Si el flow está activo en fase 5 y ya existe un `.scratch/<feature>/spec.md`
   **no vacío**, o en fase 6 y ya hay un ticket **no vacío, no oculto y no `README.md`** en
   `.scratch/<feature>/issues/`, la fase avanza sola. Las fases 7-10 son declarativas.
2. **Avanzar es del usuario.** `/flow next` y `/flow back` los ejecuta sólo el usuario; tú nunca.

El gate de escritura aplica lo dicho en «Dónde se escribe». Un `patch` es todo-o-nada sobre el conjunto
permitido. Las rutas se canonicalizan: `..` y symlinks que escapan del proyecto se bloquean. Un artefacto
vacío, oculto o llamado `README.md` no cierra el gate.

## Fase 1 — Entender

- Skill: `grilling`
- Gate: ninguno
- Cierra con: `.scratch/<feature>/understanding.md` aprobado por el usuario

Entiende, no construyas.

1. **Explora antes de preguntar.** Lee código, docs e historial; no preguntes lo que puedes averiguar leyendo.
2. **Una pregunta por turno.** Empieza por la que más cambiaría el diseño y da tu recomendación con su porqué, para que el usuario pueda aceptarla con un "sí".
3. **Sin código.** No escribas ni propongas código; en esta fase sólo escribes en `.scratch/<feature>/`.
4. Cuando no queden dudas de diseño, escribe el checkpoint en `.scratch/<feature>/understanding.md` y muéstralo con el formato del bloque común.
5. Si el slug es provisional (`flow-xxxxxx`), propón uno descriptivo y pide `/flow rename <slug>`.
6. **Espera.** Avanzar lo decide el usuario con `/flow next`: nunca lo ejecutes tú ni lo des por hecho. Si aprueba en el chat, recuérdale el comando.

Si ya trae el contexto, confírmalo en una línea y escribe `understanding.md`.

## Fase 2 — Vocabulario

- Skill: `domain-modeling`
- Gate: ninguno
- Cierra con: `.scratch/<feature>/glossary.md` aprobado por el usuario

Lee `understanding.md` y fija el vocabulario del diseño: un término, una definición, un nombre. Reutiliza los del código y la documentación; no inventes sinónimos. Las decisiones no obvias van como ADR corta (contexto, decisión, consecuencias). Si dos términos chocan, una pregunta por turno con tu recomendación.

Escribe siempre `.scratch/<feature>/glossary.md`, con las ADR cortas en una sección "Decisiones". Sólo si `docs/adr/` ya existía al arrancar pueden ir ahí, con referencia desde `glossary.md`; si no existía, todo va en `glossary.md`.

## Fase 3 — Diseño de módulos

- Skill: `codebase-design`
- Gate: ninguno
- Cierra con: `.scratch/<feature>/design.md` aprobado por el usuario

Lee `understanding.md` y `glossary.md` y usa sus términos tal cual; si un nombre no encaja, vuelve a la fase 2.

`.scratch/<feature>/design.md` define los módulos y la responsabilidad de cada uno, la interfaz estrecha (qué expone y qué oculta), las costuras y qué prueba protege cada costura. Prefiere pocos módulos profundos. Señala el mayor riesgo y, si sólo un prototipo lo responde, propón la fase 4. Sin código de implementación.

## Fase 4 — Sondear

- Skill: `prototype`
- Gate: ninguno
- Cierra con: respuesta a una pregunta de diseño anotada en `design.md`

Opcional: el usuario puede saltarla con `/flow next`. Prototipo desechable en `/tmp/opencode-proto-<feature>/`, nunca dentro del proyecto y sin commitear. Responde UNA pregunta de diseño concreta, anota la respuesta en una sección "Sondeo" de `design.md` y para.

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
