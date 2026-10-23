# SA 1.7.101 — pausa de obras e historial

Trabajo realizado exclusivamente en `feat/project-pause-readonly`, en el worktree solicitado. No se ejecutaron push, deploy ni operaciones contra datos reales.

## Comportamiento

- `Project.pause()` permite active → paused; `resume()` permite paused → active. Se conserva identidad y contenido; `pausedAt` y `updatedAt` viajan en el catálogo. Payloads de ciclo de vida inválidos se rechazan.
- La gestión se serializa y valida dentro de la transacción del catálogo. Para pausar la obra en uso primero hay que cambiar a otra. Los borradores de configuración y las restauraciones/reparaciones pendientes bloquean la operación. La UI ofrece filtro Pausados y confirmación con cancelación.
- `ProjectReadOnlyContext` consulta IndexedDB sin cambiar AppState, preferencias ni proyecto activo. El resultado es una copia inmutable. El historial incluye personal, puestos, líderes, asistencia, préstamos, cierres y caja chica. Muestra lo guardado en este dispositivo; un fallo de lectura se informa como error.
- Exportación CSV con escape de comillas y protección contra fórmulas; impresión en una ventana independiente con detalles abiertos. Los textos del historial se escapan antes de insertarlos como HTML.
- Las entradas de asistencia, formularios y cambios de estado de personal/puestos/líderes, préstamos, configuración y cierres de nómina, caja vinculada y Mini comprueban el estado de la obra. La aceptación de personal Mini vuelve a comprobarlo dentro de su transacción, antes de crear empleados o puestos. Las rutas de recepción de sincronización permanecen separadas de las operaciones locales.
- Pausar la obra inicial conserva su identificador como dueño de los registros legados sin `projectId`; la selección del proyecto operativo se resuelve aparte.

## Validación

- `npm run build`: correcto, bundle de 442 módulos y 25 assets precacheados en dist.
- `npm run test:release`: correcto para 1.7.101.
- `npm test -- --runInBand`: **663 suites PASS / 6,492 pruebas PASS / 0 fallos** tras corregir tres contratos de cableado y una excepción asíncrona de Caja Chica. Se añadieron pruebas de regresión para rechazo de guardados y para no mutar movimientos de una obra pausada.
- Playwright + Chromium: historial aislado con fixtures sintéticos, filtro de propietarios, descarga CSV, impresión, ancho móvil de 390 px, Escape y transición de reanudación. Sin errores de página.
- Pruebas específicas: modelo/catálogo, servicio/confirmaciones, aislamiento e inmutabilidad, errores de storage, guardas de escritura y propuesta Mini pausada después de revisión.

El hook de commits exige una versión nueva desde el primer cambio de aplicación. Por eso APP_VERSION/CHANGELOG y app-release.json se declararon en el primer commit; el último cierra build y validación.

La prueba de navegador es reproducible sirviendo la raíz en localhost y ejecutando `scripts/validation/project-pause-readonly.cjs` con Playwright disponible en NODE_PATH. Permite `SA_TEST_ORIGIN` y `CHROMIUM_PATH`. No abre la aplicación ni reutiliza perfiles existentes.

## Alcance y límites de la validación

- Playwright usa una página de prueba y fixtures sintéticos; no prueba inicio de sesión real, Firestore ni dos dispositivos. La reactivación y los guardas deben probarse con un entorno de ensayo aislado antes de desplegar.
- El modo historial ofrece CSV e impresión del navegador (guardar como PDF), no exportación nativa Excel ni PDF.
- Los guardas en la aplicación protegen las rutas inspeccionadas; las escrituras entrantes de sincronización y estados remotos concurrentes requieren una prueba de integración adicional.
- No se fusionó a main, no se hizo push y no se tocaron datos de producción.
