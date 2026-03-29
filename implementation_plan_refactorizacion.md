# Extracción y Centralización de Handlers Globales 🧹

Este plan se enfoca en resolver uno de los mayores problemas arquitectónicos señalados en el reporte de auditoría: la enorme cantidad de funciones colgadas del objeto `window` (ej. `window.toggleFilters`, `window.saveMultiPosition`, `window.setDayHours`, etc.) que actualmente se encuentran en `app.js`. Extraeremos esto a un nuevo módulo `GlobalHandlers.js` para aligerar `app.js` y facilitar el aislamiento de responsabilidades.

Siguiendo tus directrices estrictas, toda la refactorización se ejecutará en pequeños pasos incrementales usando la técnica de "comentar, copiar, conectar, probar, verificar y por último borrar".

## User Review Required

> [!CAUTION]
> Durante la copia y reconexión, tu app dependerá de `GlobalHandlers.js`. Revisaremos juntos después de la migración que ninguna función haya perdido contexto y los botones de la UI (en el HTML) sigan respondiendo a todos los `onclick` gracias a un puente seguro. Necesito tu aprobación estricta de este plan para comenzar.

## Plan de Acción por Fases (Estilo Alpha Refactorizer)

### Fase 1: Identificación, Centralización y Organización 🔍
- **Paso 1:** Escanear y mapear todas las funciones asignadas a `window.` (relacionadas con filtros, modales multi-posición, scroll position de UI y manipulación directa) en `app.js`.
- **Paso 2:** Analizar cuáles dependen del estado global y configurar los imports necesarios (`state`, `render`, `saveApplicationData`, `NotificationSystem`).

### Fase 3 y 4: Copia y Conexión en `GlobalHandlers.js` 🔌
#### [NEW] `js/modules/ui/GlobalHandlers.js`
- **Paso 3 (Preparación):** En `app.js`, comentaré los bloques originales dejándoles una nota explícita hacia dónde se están moviendo para referencia cruzada temporal.
- **Paso 4 (Copia y exportación):** Crearé `GlobalHandlers.js`, pegaré todo el código allí y configuraré una función `initGlobalHandlers(context)` para inyectarle dependencias como `state` y `render` (de modo que el archivo no dependa accidentalmente del framework viejo).

#### [MODIFY] `js/app.js`
- **Paso 5 (Reconexión):** Importaré `GlobalHandlers.js` en `app.js` (como ya lo hiciste con `GlobalHandlers.js` al tenerlo abierto). Montaremos las funciones en `window` mediante un puente (`GlobalHandlers.init(moduleContext)`) para mantener los `onclick=""` de tu HTML funcionando como antes de la refactorización, pero removiendo casi mil líneas del nucleo y aislando toda esta lógica de UI de `app.js`.

### Fase 5: Pruebas y Comprobación en Vida Real 🧪
- **Paso 6:** Usaré el comando local `npm run dev` (o probaré corriendo el navegador interno) para verificar los clicks en:
  - Cambiar filtros (Leader, Position).
  - Modal multi-posiciones.
  - Guardado asíncrono.
  - Horas rápidas en "Week View".

### Fase 6 y 7: Revisión de Usuario y Eliminación Purgativa 🧹
- **Paso 7:** Me detendré aquí y **te pediré que verifiques la app en tu navegador** (`http://127.0.0.1:5500/`).
- **Paso 8:** Una vez tú confirmes que la maquinaria fluye como siempre (pero bajo un capó V8 Twin-Turbo), borraré todo el código comentado residual en `app.js`.

## Open Questions
- ¿Actualmente tienes alguna otra función global conflictiva en mente (ej. los SyncFirebaseHandlers) que quieras incluir ahora mismo en esta purga, o nos limitamos a los "Attendance/Position/Filters Handlers"?

## Verification Plan

### Manual Verification
- Te indicaré que abras `http://127.0.0.1:5500/`.
- Verificaremos que el modal multi-posición abra sin arrojar errores en consola (F12).
- Verificaremos que los filtros oculten o muestren empleados correctamente sin un "ReferenceError".
- Confirmaremos que las funciones de "quick hours" apliquen inmediatamente la actualización del estado.
