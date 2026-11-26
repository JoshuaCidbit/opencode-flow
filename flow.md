# FLOW — contrato de trabajo

Reglas no negociables, activas en cada petición. Si una petición del usuario las contradice, dilo antes de continuar.

## Mapa de fases (orden prescriptivo)

| # | Fase | Skill | Cierra con |
|---|---|---|---|
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

## Prototipos (fase 4)

Escribe sólo en `/tmp/opencode-proto-<slug>`. Nunca dentro del árbol del proyecto. Es desechable: no se commitea.

## Escaladas

- `handoff`: cuando el problema excede el modelo actual; lleva evidencia (comandos, salidas, archivos).
- `research`: en segundo plano cuando falta un dato externo verificable.
- `wait-what`: cuando la premisa o el pedido no cierra; parar y preguntar.

## Trigger y gate (plugin `opencode-flow`)

El estado vive en el storage de la sesión, no en el transcript. El contrato activa es este archivo en disco.

- `/flow start [N] [slug]` — activa el flow y declara la feature. Sin slug el gate de escritura queda inactivo.
- `/flow status` — fase, gate, feature y ruta del spec.
- `/flow gate <spec|tickets|evidence|review|integration|retro>` — cierra el gate y avanza de fase.
- `/flow off` — escapatoria; desactiva todo.
- `/workflow …` — alias.

Tres reglas de uso:

1. **Silencio mientras está inactivo.** Con el flow apagado el plugin no inyecta nada: ni recordatorio ni
   contrato. Es opt-in y se mantiene invisible hasta que el usuario escribe `/flow`.
2. **Arrancar en fase 5 no exige las fases 1-4.** `/flow start 5 <slug>` instruye a sintetizar lo que ya
   haya en la conversación y escribir `.scratch/<slug>/spec.md` de una, marcando los supuestos.
   `.scratch/` se resuelve contra la raíz del proyecto (`ctx.location.project.directory`).
3. **Auto-avance por artefacto.** Si el flow está activo en fase 5 y ya existe `.scratch/<feature>/spec.md`,
   o en fase 6 y ya hay algún `*.md` en `.scratch/<feature>/issues/`, la fase avanza sola: no hace falta
   `/flow gate spec|tickets`. Las fases 7-10 son declarativas y no auto-avanzan.

El gate sólo intercepta herramientas de escritura (`write`, `edit`, `patch`, `multiedit`): leer, buscar y
ejecutar comandos quedan fuera de su alcance. Bloquea cuando hay feature declarada y falta el artefacto:

- fase 5 → exige `.scratch/<feature>/spec.md`
- fase 6 → exige tickets `*.md` en `.scratch/<feature>/issues`
- fase 1-4 y 7-10 → declarativas: el gate se cierra a mano

`patch` es todo-o-nada: se permite únicamente si **todos** los archivos del `patchText` son el artefacto
exigido. Si además toca código del proyecto, o si no se puede parsear, bloquea. Escribir el propio artefacto
siempre está permitido.

Si el runtime no expone hooks de herramientas, el gate se desarma y lo dice al arrancar: nunca rompe la sesión.

La tabla de fases de arriba es la fuente de verdad en prosa; el plugin la refleja en `src/phases.ts`.
Si cambias una, cambia la otra.
