# Restablecer Calendario con Arquitectura POO Reusable

Siguiendo la sugerencia de diseño, vamos a centralizar la lógica de manejo de fechas en un nuevo gestor dentro de `DateManagers.js`. Esto permitirá que cualquier parte de la aplicación que necesite un selector de fecha única pueda reutilizar la lógica, no solo la sección de asistencia.

## User Review Required

> [!IMPORTANT]
> Se introducirá una nueva clase base `SingleDateManager` en `DateManagers.js`. Esto mejora la mantenibilidad y permite una integración limpia con el sistema de componentes actual.

## Proposed Changes

### [Módulo Utils] [DateManagers.js](file:///c:/Users/the_b/OneDrive%20-%20Universidad%20Autonoma%20de%20Santo%20Domingo/Educacion/Independiente/control%20de%20asistencia%20mini/aplicacionFull/js/modules/utils/DateManagers.js)

#### [NEW] Clase `SingleDateManager`
- Gestiona una única fecha (`selectedDate`).
- Métodos: `changeDate(delta)`, `togglePicker(target)`, `selectDate(dateKey)`.

#### [NEW] Clase `AttendanceDateManager`
- Extiende `SingleDateManager` específicamente para la navegación principal de asistencia.
- Maneja la lógica de "Día" vs "Semana" al cambiar de fecha.

### [EntryPoint] [app.js](file:///c:/Users/the_b/OneDrive%20-%20Universidad%20Autonoma%20de%20Santo%20Domingo/Educacion/Independiente/control%20de%20asistencia%20mini/aplicacionFull/js/app.js)

#### [MODIFY] Integración del Manager
- Inicializar `attendanceDateManager`.
- Definir los puentes globales (`window.toggleDatePicker`, `window.changeDate`, `window.DatePicker`) invocando los métodos del manager.
- Esto restaura la funcionalidad que `AttendanceUI.js` espera encontrar.

### [Módulo UI] [AttendanceHandlers.js](file:///c:/Users/the_b/OneDrive%20-%20Universidad%20Autonoma%20de%20Santo%20Domingo/Educacion/Independiente/control%20de%20asistencia%20mini/aplicacionFull/js/modules/ui/AttendanceHandlers.js)

#### [CLEANUP] 
- Asegurar que no haya duplicidad de lógica de fechas aquí.
- Mantener solo los manejadores específicos de asistencia (horas base, feriados).

## Open Questions

- ¿Debería el cambio de fecha en modo "Semana" avanzar de 7 en 7 días o mantenerse día a día? (Propuesta: 7 días en vista semanal, 1 día en vista diaria).

## Verification Plan

### Manual Verification
1. Abrir la aplicación y verificar que no hay errores de consola al cargar.
2. Hacer clic en las flechas de la barra de navegación:
   - En Vista Diaria: Debe cambiar día a día.
   - En Vista Semanal: Debe cambiar de semana en semana.
3. Abrir el calendario flotante, seleccionar una fecha y verificar que la UI se actualiza correctamente.
