# Multiobra: pruebas independientes y cierre de issues

Este paquete contiene las reproducciones y recorridos de R1–R7 (#296–#302).
Está separado de la suite normal: vive en `qa/multiobra360/`, con configuraciones
Jest propias y tests de navegador de producción por componentes.

## El resto de la aplicación puede avanzar

- `npm test` sigue ejecutando la suite habitual de `js/tests/`.
- Los tests de aceptación pendientes no se descubren desde esa suite.
- El guard de releases clasifica qa/ como pruebas, igual que scripts/ y docs/: no exige nuevas versiones por cambiar solo este paquete.
- No se modifican las protecciones de ramas ni se añade este flujo como check
  obligatorio de todos los commits/PR.
- El workflow de aceptación solo responde a una petición manual o al cierre
  de uno de los siete issues.
- Otro workflow ligero verifica la política del paquete cuando un PR cambia
  estos archivos; sus tests no ejecutan las regresiones pendientes del producto.

## Publicación y activación

La rama del PR publica código y guía. Para activar eventos manuales y de issues,
la definición de workflow debe integrarse en la rama por defecto del repositorio.
Hasta fusionar el PR, la política de cierre **está preparada, no activa**.

Después de integrar:

1. Abrir Actions → **Multiobra issue acceptance** → Run workflow.
2. Seleccionar issue (296–302) y rama/SHA de la aplicación.
3. Dejar `close_if_passed=false` para consultar una corrección en una rama.
4. Para cerrar, integrar primero la corrección, completar los criterios del
   issue y validar el `main` vigente con `close_if_passed=true`.
5. La automatización comenta el commit, resultado y enlace a artefactos.
   Si todo pasa y main no cambió durante la ejecución, cierra como resuelto.

También se puede pulsar Close issue: al iniciarse el workflow, lo vuelve a abrir
mientras verifica. Solo vuelve a cerrarlo si se cumplen las mismas condiciones.
Si las pruebas fallan, se cancelan, no llegan a ejecutarse o faltan criterios,
permanece abierto.

Esto es una regla de automatización, **no un bloqueo nativo del botón de GitHub**.
Hay un intervalo entre el clic y la ejecución; un administrador puede desactivar
Actions o modificar la política. No se promete una restricción absoluta.

## Cierre por punto, sin esperar a resolver los otros seis

Cada ejecución selecciona el punto y controles positivos compartidos:

| Issue | Punto | Tests locales seleccionados | Recorridos navegador | SDK/emulador |
| --- | --- | ---: | ---: | ---: |
| #296 | R1 — sesión | 25 | 8 | 0 |
| #297 | R2 — edición local | 25 | 4 | 0 |
| #298 | R3 — restauración | 24 | 12 | 0 |
| #299 | R4 — configuración activa | 27 | 4 | 0 |
| #300 | R5 — semilla editada | 24 | 14 | 0 |
| #301 | R6 — contexto | 22 | 4 | 0 |
| #302 | R7 — concurrencia nube | 20 | 6 | 4 |

Los 20 controles compartidos se solapan con algunos tests del propio punto.
La ejecución completa sin selección conserva 47 tests locales, 4 SDK/emulador
y 52 recorridos (26 escenarios a 390 y 1280 píxeles).

Los tests ajenos que Jest filtra por nombre pueden aparecer como pending en su
JSON: no bloquean ese issue. Una prueba **seleccionada** omitida, sustituida o
sin evidencia sí impide aprobar el cierre. El manifiesto fija nombres y cantidad
de pruebas y cada par escenario/anchura para impedir aprobaciones vacías.

## Ejecutar localmente en a2

```bash
cd /home/ubuntu/worktrees/sa-multiobra-issue-gates-20261024
node qa/multiobra360/run.cjs --all --issue=296
```

Cambiar 296 por cualquier número hasta 302. Para todos:

```bash
node qa/multiobra360/run.cjs --all
```

Modos parciales, útiles para depurar pero insuficientes para cerrar:

```bash
node qa/multiobra360/run.cjs --unit --issue=296
node qa/multiobra360/run.cjs --browser --issue=296
```

Resultados locales: `qa/multiobra360/results/latest/`.
Incluye JSON de Jest, logs, capturas, `summary.md`, `coverage.json` y
`closure-eligibility.json`. El último archivo explica si la evidencia local es
elegible; no cierra nada por sí mismo.

La carpeta es reemplazada al ejecutar; no sumar capas de ejecuciones distintas.
Para validar un cierre, usar siempre --all, con ambas anchuras y sin skips.
Los checks de aplicación reales deben pasar; no usar test.failing ni cambiar las
aserciones para describir el comportamiento defectuoso.

## Entorno y alcance

Las pruebas usan datos sintéticos y emulador local, sin credenciales productivas.
En navegador se recorren componentes reales, servicios, IndexedDB nativo y el SDK
Firestore. La identidad externa está simulada: OAuth Google, arranque completo de
index.html, PWA, reglas desplegadas, Supabase y fotos no quedan certificados.
Los criterios manuales originales de los issues deben verificarse y marcarse;
que este paquete pase no sustituye las comprobaciones fuera de su alcance.

Se comprueba integridad de empleados, préstamos/pagos, puestos, líderes,
asistencias y un cierre sintético. R7 usa dos navegadores aislados y un tercero
para la descarga. El workflow guarda artefactos durante 14 días.

En Actions, el job que ejecuta código de aplicación solo tiene contents:read y
checkout sin credenciales persistidas. Los jobs de apertura/cierre tienen
issues:write pero no ejecutan código del checkout de aplicación. El paquete de
tests se copia desde la rama por defecto, no desde la rama de la corrección.

SDK de pruebas fijado: Firebase 12.19.0 (el usado en la auditoría). El runtime
productivo conserva su SDK original; este PR no lo actualiza. Java 21 y emulador
Firestore 1.22.0 con SHA-256 verificado. CI usa Chromium/Chrome del runner.

Para otra máquina, instalar dependencias con npm ci --ignore-scripts y configurar:

```bash
MULTIOBRA_JAVA=/ruta/java21/bin/java \
FIRESTORE_EMULATOR_JAR=/ruta/firestore-emulator.jar \
SA_EMULATOR_NODE_MODULES=/ruta/con/firebase/node_modules \
CHROMIUM_PATH=/ruta/chromium \
node qa/multiobra360/run.cjs --all --issue=296
```

## Verificar la política y workflows sin cerrar ningún issue

```bash
node --test qa/multiobra360/*.test.cjs
```

Cubre evidencia completa, fallos, skips/todo seleccionados, filtrados ajenos,
recorridos/anchuras ausentes, integridad, commit inmutable, modos parciales,
permisos de jobs y condiciones de apertura/cierre. Las llamadas GitHub de estos
tests son dobles de prueba; no escriben en GitHub.

El PR de infraestructura no resuelve ni cierra R1–R7. Las correcciones de producto
deben hacerse y validarse por separado.
