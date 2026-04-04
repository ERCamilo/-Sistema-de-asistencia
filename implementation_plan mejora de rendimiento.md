# Plan de Optimización para Crecimiento a Largo Plazo

## 🚀 El Problema
Actualmente, para mostrar los **Totales** en la vista semanal o diaria, el sistema realiza una búsqueda (filtrado) sobre **todos los registros de asistencia históricos**.
- Si tienes 200 registros, es rápido.
- Si tienes **5,000 registros** después de un año, el sistema tendrá que procesar 5,000 elementos cada vez que se dibuje un checkbox o se cambie el día. Esto causará que la aplicación se sienta pesada o lenta (los avisos de `Violation` crecerán).

## 🛠️ Solución Propuesta: Indexación por Fecha
En lugar de buscar en todo el historial, crearemos un "Índice" (un mapa rápido) que nos diga exactamente qué registros pertenecen a qué fecha.

### 1. ⚡ Creación de un Índice de Datos ([AppState.js](file:///c:/Users/the_b/OneDrive%20-%20Universidad%20Autonoma%20de%20Santo%20Domingo/Educacion/Independiente/control%20de%20asistencia%20mini/aplicacionFull/js/modules/core/AppState.js))
Agregaremos una propiedad oculta al estado que mantenga una lista de registros agrupados por fecha.
- **Antes**: Buscar en todo el historial (O(N)).
- **Después**: Acceso directo por fecha (O(1)).

### 2. 🎨 Optimización de Totales ([AttendanceUI.js](file:///c:/Users/the_b/OneDrive%20-%20Universidad%20Autonoma%20de%20Santo%20Domingo/Educacion/Independiente/control%20de%20asistencia%20mini/aplicacionFull/js/modules/ui/AttendanceUI.js))
Actualizaremos la función `WeekViewTotalsRow` para que consulte el índice. Esto hará que el cálculo de totales sea instantáneo sin importar cuántos meses de datos tengas.

### 🧹 3. Gestión de Memoria ([PersistenceService.js](file:///c:/Users/the_b/OneDrive%20-%20Universidad%20Autonoma%20de%20Santo%20Domingo/Educacion/Independiente/control%20de%20asistencia%20mini/aplicacionFull/js/modules/services/PersistenceService.js))
Aseguraremos que el índice se auto-genere al cargar la aplicación y se mantenga sincronizado al guardar cambios.

## ❓ Preguntas para el Usuario

> [!IMPORTANT]
> **¿Deseas que implementemos también un sistema de "Archivo de Datos"?**
> Aunque el índice optimiza la velocidad, el archivo de guardado seguirá creciendo en disco. Podemos añadir una opción para mover datos antiguos (ej. de más de 6 meses) a un archivo separado.
> **Mi recomendación**: Primero optimicemos la velocidad (este plan) y veamos si el tamaño del archivo llega a ser una molestia.

## Plan de Verificación

- **Prueba de Carga**: Simularemos 2,000 registros para comprobar que la interfaz sigue respondiendo en menos de 100ms.
- **Verificación de Consistencia**: Confirmar que al marcar una asistencia, el total se actualiza correctamente usando el nuevo índice.
