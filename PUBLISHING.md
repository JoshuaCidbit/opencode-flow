# Publicación pendiente — v0.3.0

**No etiquetar v0.3.0 hasta que el usuario confirme la prueba manual en OpenCode real.**

El paquete pasa typecheck y 147 tests automáticos, pero la visibilidad del estado en la TUI
(`session.instructions.entry`, `session.synthetic` con `delivery:"steer"`) **sólo está verificada
contra los tipos del runtime**, no en pantalla. Ver `README.md`, "Verificación pendiente".

## Checklist de prueba manual (una sesión real, OpenCode ≥ 2.4.2)

1. `/flow` → aparece el brief de fase 1 y, si la TUI lo muestra, la línea `[flow] fase 1 · activo…`.
2. Escribir fuera de `.scratch/` en fase 1-6 → bloqueado con motivo claro.
3. Escribir `.scratch/<slug>/spec.md` vacío → NO avanza. Con contenido → auto-avance a 6 **y aviso**.
4. `/flow back` → vuelve a 5 y reabre el gate.
5. `/flow off` → desaparece la línea de estado; el mensaje dice `/flow resume`.
6. Nueva sesión sobre el mismo proyecto → ofrece retomar la feature de `.flow-feature`.
7. `/flow resume` → fase deducida de los artefactos, no adivinada.

Cuando los 7 pasen, borra este archivo, sube la versión si hace falta y etiqueta.

## Cómo se publica (después de la confirmación)

```
npm test && npm run typecheck
git tag -a v0.3.0 -m "opencode-flow v0.3.0"
git push origin v0.3.0
```
