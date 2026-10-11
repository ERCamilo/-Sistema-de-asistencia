# Ajustes: guardado, borradores y pantallas — 2026-10-11

Base: main `846084c9` (v1.7.55). Se corrigen los ocho problemas confirmados en la revisión de General, Calendario, Datos y Tests.

## Comportamiento

- Guardar rechaza campos numéricos vacíos, valores no finitos y valores fuera de los límites antes de cambiar ajustes o anunciar éxito. La deducción de 0 % conserva cero al guardar, renderizar y recargar. Los límites mostrados coinciden con los aceptados por el handler y se mantienen los incrementos anteriores de los factores y porcentajes.
- Un render conserva texto, selecciones y checkboxes editados, además del foco y selección cuando corresponde. Los cambios de campos no editados se incorporan normalmente. Si otro dispositivo cambia el mismo campo, el borrador queda visible y Guardar pide confirmar la sobrescritura; Descartar usa el valor remoto más reciente. Una confirmación queda invalidada si cambian el borrador, el ámbito o la revisión mientras está abierta.
- Guardar reconcilia primero los valores más recientes del estado, incluso si aún no se ejecutó el siguiente frame: los campos no editados incorporan la actualización y los editados entran en el guard de conflictos.
- Un cambio de proyecto con un borrador activo bloquea el guardado hasta descartarlo. Un panel de carga temporal conserva los campos ausentes en memoria para restaurarlos cuando reaparecen; ese estado nunca se persiste o sincroniza. El guard existente de navegación también descarta explícitamente cuando el usuario confirma salir.
- El selector de ayuda usa los modos aceptados por HelpController y responde a change y teclado. Las preferencias antiguas `once`/`hidden` conservan su significado al leerse. La notificación usa texto comprensible. Desactivar ayuda automática mantiene disponible la ayuda manual.
- La foto de cuenta en Datos revela iniciales locales si falla. No solicita otro servicio de avatares ni vuelve a descargar la misma foto después de renders que no cambian la identidad o URL.
- La barra de borrador distribuye texto y botones en filas y deja espacio para la navegación inferior y el área segura. Calendario adapta columnas y celdas a pantallas estrechas, manteniendo legibles las entradas de fecha. Campos y pestañas tienen etiquetas/nombres accesibles; los interruptores muestran foco y las opciones de préstamos separan título y descripción.

## Pruebas

Se incorporaron 43 pruebas de comportamiento en `SettingsBehaviorRegressions.test.js` y `SettingsDraftConflicts.test.js`.

El harness de guardado lee y ejecuta la función real de app.js con dependencias controladas; no contiene una copia de la implementación. Las pruebas de ayuda montan el selector real y envían change al listener real. Las de borrador ejercitan el merge remoto y DOMDiff, y una ejecuta el RenderManager real. La prueba del avatar ejecuta el onerror renderizado y vuelve a aplicar el componente para verificar que no reaparezca la foto fallida.

Las 11 regresiones iniciales se ejecutaron sobre una copia de la base inmutable obtenida con git archive: las 11 fallaron por los comportamientos observados y pasaron con las correcciones. Se añadieron casos de límites, configuración por proyecto, preferencias anteriores, accesibilidad, ecos, convergencia, cambios durante la confirmación y paneles de carga. También se corrigió la prueba antigua de initSettingsUI para que compruebe el consumo real del getter, y se precisaron nombres/comentarios que prometían más cobertura que sus aserciones.

La suite completa pasó: **5.508 pruebas en 585 suites**, usando Node 20 y dos workers. El control de escrituras de estado no registra deuda nueva y el manifiesto de precache sigue vigente. El build de producción pasa.

`npm run test:settings-layout` prueba General y Calendario en Chromium real a 320, 390, 820 y 1440 px, con componentes y CSS del repositorio y datos sintéticos. Comprueba desbordamiento, etiquetas, ancho mínimo legible de la entrada de fecha, botones dentro de la barra y separación de la navegación. Se incorpora al CI después del build; no necesita cuentas, Firebase ni servicios externos. Se validó localmente también con Node 20.

En una comprobación adicional con el SDK real, la aplicación sin empaquetar y el paquete `dist` pasaron los flujos de rechazo de números vacíos, 0 % conservado tras recargar, ayuda con teclado y cancelación/confirmación de un conflicto de borrador. Las cuatro pestañas se comprobaron en los cuatro anchos anteriores; no se detectaron errores JavaScript.

## Límites de la verificación

No se inició sesión ni se modificaron cuentas, respaldos o datos reales. Las actualizaciones externas se simularon mediante el estado o el callback de sincronización, por lo que no sustituyen una comprobación del transporte real entre dispositivos. La persistencia local y los flujos de interfaz sí se ejecutaron en navegador.

Las estadísticas globales de almacenamiento y la distinción entre cuenta iniciada y conectividad real, señaladas como mejoras adicionales en la revisión, quedan fuera de este cambio.
