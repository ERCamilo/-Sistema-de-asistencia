# Reporte de Auditoría Visual y de Usabilidad UX/UI

Este documento presenta los resultados de la auditoría visual y de usabilidad realizada en la aplicación de control de asistencia para las resoluciones de escritorio (Desktop: 1440x900px) y móvil (Mobile: 375x812px). Se detallan los hallazgos agrupados por vistas, se clasifican según su orden de importancia y se proponen mejoras de diseño estructural.

---

## 1. Análisis Detallado por Vista y Modal

### A. Pantalla de Carga y Onboarding (Asistente de Configuración)

* **Versión Móvil (Mobile)**:
  * **Problema de Desbordamiento y Bloqueo de Navegación**: En la pantalla de bienvenida y en la selección de modo de inicio, los botones de acción principal (como "Comenzar desde Cero", "Siguiente" o "Atrás") quedan cortados en la parte inferior o empujados fuera del viewport de 812px. El contenedor principal no implementa un scroll vertical claro en dispositivos móviles pequeños, impidiendo que el usuario pueda avanzar o retroceder fácilmente si la pantalla es corta.
  * **Causa Técnica**: El archivo [Onboarding.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/ui/Onboarding.js) define estilos en línea con paddings fijos muy altos (`padding: 60px 40px`, `margin-bottom: 40px` en múltiples capas) que exceden la altura disponible de viewports compactos.
  * **Superposición de Notificaciones de Versión**: Al iniciar la aplicación, la caja de alerta de actualización ("Nueva versión disponible") se renderiza de forma absoluta sobre la zona de bienvenida del Onboarding, colisionando con el título principal ("Elige la opción que mejor se adapte a ti") y tapando los textos superiores.

* **Versión Escritorio (Desktop)**:
  * **Alineación Correcta pero Espacio Subutilizado**: Aunque los textos y elementos del asistente se leen perfectamente en Desktop, el flujo paso a paso muestra cajas centralizadas de ancho limitado que dejan grandes márgenes oscuros vacíos en los laterales de la pantalla de 1440px.

---

### B. Panel Principal de Asistencia (DayView y WeekView)

* **Versión Escritorio (Desktop)**:
  * **Desaprovechamiento Horizontal en Vista Diaria (DayView)**: Las tarjetas de resumen (Presentes, Ausentes, Horas, Extras), el buscador de empleados, el selector de líderes y las filas de cada empleado se extienden al 100% de la anchura horizontal de la pantalla. Esto produce un estiramiento excesivo que dificulta la lectura visual horizontal de los datos y limita la cantidad de filas visibles. Cada fila de empleado es innecesariamente alta y ancha, mostrando solo 1.5 registros en pantalla al mismo tiempo.
  * **Causa Técnica**: El archivo [attendance_ui.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/attendance_ui.css) define elementos de lista y tarjetas con layouts flexibles al 100% de la anchura de su contenedor padre (`.employee-row`, `.stats-row`), sin limitar el ancho máximo (`max-width`) o reestructurar a un diseño multi-columna en resoluciones amplias.
  * **Etiquetas de Pestañas Inconsistentes**: El selector de tipo de vista alterna las etiquetas asimétricamente. En la Vista Diaria se muestra "Día" / "S" (Semana abreviada), mientras que al pasar a la Vista Semanal cambia a "D" (Día abreviado) / "Semana". Esto ocurre en la función `DateControls` dentro de [AttendanceUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/ui/AttendanceUI.js#L247-L248).
  * **Ubicación de Barra de Navegación Global**: El menú de secciones principal (Asistencia, Personal, Reportes, Nómina, Ajustes) se fuerza en la base de la pantalla (Bottom Navigation Bar). Aunque es un patrón cómodo en móviles, en pantallas de escritorio obliga al usuario a desplazar la vista continuamente hacia la parte inferior y deja vacío el espacio lateral de navegación.

* **Versión Móvil (Mobile)**:
  * **Desbordamiento de Controles de Fecha**: La barra de controles de asistencia inferior (Feriado, Horas a Asignar, Navegación: Hoy) se corta en los márgenes izquierdo y derecho de un dispositivo de 375px de ancho debido a que las cajas de control internas no disminuyen de tamaño adecuadamente.
  * **Compresión en Filtro y Buscador**: La barra de búsqueda y el filtro de líderes comparten la misma línea horizontal (50% de ancho cada uno). Esto provoca que el texto de marcador de posición ("Buscar por nombre, nú...") y las opciones de líderes ("Todos los Líd...") queden incompletas y difíciles de comprender.
  * **Compresión de Tarjetas KPI**: Las 4 tarjetas de estadísticas principales se fuerzan a estar juntas en una sola fila en móviles, provocando etiquetas de texto comprimidas y números difíciles de leer en pantallas estrechas.
  * **Tabla Semanal (WeekView) Inusable**: La primera columna fija de la tabla semanal ("EMPLEADO") ocupa casi el 50% del ancho útil del móvil. Esto deja espacio para mostrar únicamente 2 días de la semana (por ejemplo, Lunes y Martes) de forma simultánea. Para consultar el resto de la semana, el usuario debe realizar desplazamientos horizontales largos.
  * **Redundancia del Año en Cabeceras**: En la tabla de la semana, las cabeceras repiten el año actual en cada celda (`Lun, 25 may 2026`, `Mar, 26 may 2026`, etc.). Esto ensancha artificialmente las columnas de la tabla y reduce la cantidad de días que caben en pantalla.

---

### C. Ficha y Perfil del Empleado (EmployeeProfileModal)

* **Versión Escritorio (Desktop)**:
  * **Presentación Estética Adecuada**: El modal del perfil del empleado se renderiza de forma centralizada con un fondo semitransparente oscuro muy bien integrado. La jerarquía de pestañas e información es correcta y aprovecha bien el espacio asignado dentro del modal.

* **Versión Móvil (Mobile)**:
  * **Colisión Severa en la Cabecera**: El botón de retroceso (`← Volver`) en la esquina superior izquierda colisiona directamente con el nombre del empleado. Dado que el nombre del empleado (ej. `Juan Pérez`) se envuelve en dos líneas debido a restricciones de espacio horizontal, se superpone con el texto de navegación.
  * **Compresión y Superposición de Pestañas**: Las pestañas de navegación del perfil (`Resumen`, `Nómina`, `Asistencia`, `Documentos`) están configuradas en una única fila horizontal rígida. En pantallas móviles, los nombres de las pestañas se superponen entre sí y sus iconos (emojis) colisionan con el texto del botón adyacente (ej. `Resume💰 Nómina📅 Asistenc...`), dando un aspecto desordenado e ilegible.
  * **Causa Técnica**: El archivo [employee_profile.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/employee_profile.css) no define comportamiento scrollable en el contenedor de pestañas (`.profile-tabs` o equivalente) ni envuelve las pestañas con flex-wrap para ajustar su disposición en dispositivos móviles.

---

### D. Panel de Ajustes y Configuración (SettingsUI)

* **Versión Escritorio (Desktop)**:
  * **Pantalla de Ajustes Inicial Vacía (Bug de Inicialización)**: Cuando el usuario abre la sección de ajustes por primera vez, el panel inferior se muestra totalmente vacío, dejando una gran sección negra sin opciones ni formularios. Solo son visibles los botones superiores de sub-pestañas (`Datos`, `General`, `Calendario`) y el pie de página de la versión.
  * **Causa Técnica**: El estado inicial definido en [AppState.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/core/AppState.js) carece del campo `settingsActiveTab` inicializado por defecto (como `general` o `data`). Al abrir la sección por primera vez, la variable está indefinida y el renderizador en [SettingsUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/ui/SettingsUI.js) no evalúa ningún panel.
  * **Contenido Cortado en la Base**: Al seleccionar una sub-pestaña como "Calendario" o "Datos", el formulario se extiende verticalmente hacia abajo y queda cortado por la barra de navegación del sistema, impidiendo visualizar el final del calendario o de la lista de copias de seguridad locales. No hay scroll de página en esta sección.

* **Versión Móvil (Mobile)**:
  * **Ocultamiento de Etiquetas en Pestañas**: En la barra de sub-pestañas, las palabras `Datos`, `General` y `Calendario` se ocultan de forma forzada, mostrando únicamente iconos pequeños en forma de caja. Para un usuario nuevo, es muy difícil adivinar qué significa cada botón de configuración sin un texto descriptivo.
  * **Título Cortado**: El encabezado "Configuración del Sistema" se divide de manera tosca en dos líneas ("Configuración del" / "Sistema") debido a la falta de ajuste dinámico de tamaño de fuente.

---

### E. Panel de Personal (EmployeesTab)

* **Versión Móvil (Mobile)**:
  * **Filtros e Iconos Crípticos sin Etiquetas**: La barra de búsqueda y los filtros por Puesto, Líder y Estado se comprimen en una fila de cuatro botones cuadrados muy pequeños que solo contienen iconos (sin etiquetas explicativas ni tooltips). El usuario no tiene forma de saber qué hace cada botón sin presionarlo previamente.
  * **Botones Apilados a la Derecha**: Las tarjetas de empleado (`EmployeeCard`) colocan tres botones de acción apilados verticalmente a la derecha (Ver Perfil, Editar, Pausar). En pantallas móviles, esta columna de botones resta una cantidad considerable de espacio horizontal a la información crítica del empleado (nombre, cargo, sueldo, líder), haciendo que el texto se envuelva excesivamente y aumente el alto de cada tarjeta.
  * **Causa Técnica**: El archivo [EmployeesList.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/employees/EmployeesList.js) define los botones en una columna de flex vertical con anchos fijos a la derecha del contenido, reduciendo el ancho del bloque de texto a menos del 70% del viewport.
  * **Información Confusa de Salario**: Para los empleados con salario mensual configurado, la tarjeta muestra en su primer renglón de metadatos un valor de `$0/día (Estándar)`, lo cual resulta confuso y técnicamente erróneo.

* **Versión Escritorio (Desktop)**:
  * **Inconsistencia de Patrón en Buscadores**: El comportamiento de los filtros en la pestaña Personal (que se expanden como pestañas flotantes o popovers compactos) difiere del patrón de buscador continuo y inputs selectores directos expuestos en la pestaña de Asistencia, rompiendo la coherencia visual interna.

---

### F. Panel de Reportes (ReportsTab)

* **Versión Móvil (Mobile)**:
  * **Tabla de Asistencia Gigante Horizontal**: El reporte general de asistencia por días del mes se dibuja como una tabla HTML tradicional con hasta 31 columnas diarias. Al visualizarse en dispositivos móviles de 375px, el scroll horizontal es inevitable y muy difícil de operar, ya que al desplazarse hacia la derecha para ver los días de fin de mes se pierde de vista el nombre del empleado a la izquierda.
  * **Saturación de Color (Sopa de Color)**: Las celdas de asistencia de la tabla usan fondos de colores sólidos brillantes y contrastados para representar marcas (Verde, Rojo, Naranja). En una vista móvil de varias columnas, esto crea una saturación visual intensa que distrae y fatiga la lectura.
  * **Ajuste de Botones Rápidos de Rango**: Los tres botones de rango rápido ("Esta Semana", "Este Mes", "Período Actual") y los pickers de fecha "Desde/Hasta" se apilan de forma tosca debido a que el espacio horizontal no es suficiente, desorganizando los márgenes de los paneles.

---

### G. Panel de Nómina (PayrollTab)

* **Versión Móvil (Mobile)**:
  * **Flujo de Pasos con Numeración Inconsistente**: Los paneles colapsables del flujo de nómina están etiquetados de forma asimétrica como: `Paso 1: Período de Pago`, `Paso 2: Deducciones Globales`, `Paso 2B: Bonificaciones Globales` y `Paso 3: Vista Previa`. Esta nomenclatura (`Paso 2` seguido de `Paso 2B` y luego saltar a `Paso 3` mientras se tiene código para un `Paso 4` oculto) no es secuencial y confunde el flujo guiado.
  * **Causa Técnica**: En [PayrollUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/payroll/PayrollUI.js), las etiquetas de texto de los encabezados de los pasos están escritas en duro con esta estructura no correlativa.
  * **Desalineación de Campos de Formulario en Acordeón**: Los formularios para agregar deducciones y bonificaciones individuales utilizan un grid de CSS auto-fit con un ancho mínimo de `160px`. En móviles, esto causa que los inputs (Empleado, Tipo, Monto, Nombre y el botón Agregar) se acomoden en filas desequilibradas con distintas alturas y anchos, rompiendo la estructura de formulario vertical estándar.
  * **Doble Scroll en Vista Previa (Tabla Neto)**: La tabla de previsualización final (Paso 3) que muestra el Bruto, Bonificaciones, Deducciones y Neto tiene demasiadas columnas para móvil, obligando a un scroll horizontal contenido dentro de un acordeón que a su vez tiene scroll vertical. Esto genera un efecto de scroll anidado sumamente incómodo.

---

## 2. Lista de Hallazgos Clasificada por Importancia

A continuación, se agrupan los problemas detectados en tres niveles de prioridad para facilitar su planificación y corrección técnica.

### Prioridad Alta (UX Grave / Errores Funcionales Visuales)

1. **Ajustes iniciales vacíos**: Al pulsar la sección "Ajustes", no se muestra contenido inicial bajo las pestañas de configuración. El usuario se encuentra con un área vacía y negra.
   * **Ubicación en Código**: [AppState.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/core/AppState.js#L122-L196) (falta de inicialización del campo `settingsActiveTab`).
2. **Onboarding móvil cortado**: Falta de scroll vertical y paddings exagerados en el contenedor `.onboarding-overlay` que ocultan los botones de acción para avanzar ("Siguiente", "Comenzar") en móviles cortos.
   * **Ubicación en Código**: [onboarding.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/onboarding.css) y [Onboarding.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/ui/Onboarding.js).
3. **Pestañas colisionadas en Perfil Móvil**: Los nombres y emojis de las pestañas internas del perfil del empleado se amontonan horizontalmente en una sola palabra ilegible.
   * **Ubicación en Código**: [employee_profile.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/employee_profile.css) (falta flex-wrap o scroll horizontal en `.profile-tabs`).
4. **Colisión en Cabecera del Perfil**: El botón de retroceso `← Volver` y el nombre del empleado se enciman verticalmente en pantallas móviles.
   * **Ubicación en Código**: [employee_profile.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/employee_profile.css) (estructura de la cabecera del perfil).
5. **Desbordamiento de la Barra de Controles en Móvil**: Los márgenes izquierdo y derecho de los controles principales de asistencia se desbordan de la pantalla de 375px.
   * **Ubicación en Código**: [attendance_ui.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/attendance_ui.css) (estilos de `.view-controls-row` y `.control-section`).
6. **Tabla de Asistencia Gigante Horizontal (Reportes Móvil)**: El reporte general de asistencia por días del mes tiene hasta 31 columnas, lo que obliga a un scroll horizontal excesivo en móviles donde se pierde de vista el nombre del empleado.
   * **Ubicación en Código**: [AnalyticsUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/analytics/AnalyticsUI.js) (estructura de la tabla general).

### Prioridad Media (Inconsistencias / Diseño Poco Adaptable)

1. **Desaprovechamiento horizontal en Desktop**: Filas y tarjetas excesivamente anchas en pantallas de escritorio, con altura exagerada que solo muestra 1.5 empleados a la vez.
   * **Ubicación en Código**: [attendance_ui.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/attendance_ui.css).
2. **Corte vertical en Formularios de Ajustes (Desktop)**: Pérdida de controles de calendario y copias de seguridad en la parte baja debido a falta de scroll y bloqueo por la barra de navegación inferior.
   * **Ubicación en Código**: [styles.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/styles.css) (scroll del contenedor de la SPA).
3. **Filtros y buscador squished en móvil (Dashboard)**: Truncamiento de textos y placeholders en la barra de búsqueda y selector de líderes en móviles al forzarlos al 50% de ancho en una sola fila.
   * **Ubicación en Código**: [attendance_ui.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/attendance_ui.css) (clases `.search-wrapper`).
4. **Inconsistencia de etiquetas de vista**: Letras abreviadas ("S" para semana y "D" para día) alternadas inconsistentemente según el modo activo.
   * **Ubicación en Código**: [AttendanceUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/ui/AttendanceUI.js#L247-L248).
5. **Sub-pestañas de Ajustes crípticas en Móvil**: Desaparición de las palabras descritivas `Datos`, `General` y `Calendario` en móviles, obligando a interactuar a través de iconos poco intuitivos.
   * **Ubicación en Código**: [SettingsUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/ui/SettingsUI.js).
6. **Filtros crípticos de Personal (Móvil)**: Barra de búsqueda y filtros por puesto, líder y estado reducidos a iconos sin texto ni etiquetas, resultando confusos.
   * **Ubicación en Código**: [EmployeesUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/employees/EmployeesUI.js).
7. **Botones verticales apilados en Personal (Móvil)**: Tres botones de acción a la derecha de la tarjeta de empleado squishean el espacio horizontal útil de texto.
   * **Ubicación en Código**: [EmployeesList.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/employees/EmployeesList.js).
8. **Inconsistencia de Pasos en Nómina**: Numeración no correlativa de los paneles (`Paso 1`, `Paso 2`, `Paso 2B`, `Paso 3`) que confunde al usuario en el flujo de nómina.
   * **Ubicación en Código**: [PayrollUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/payroll/PayrollUI.js).
9. **Formularios desalineados en Nómina (Móvil)**: Rejilla CSS auto-fit con mínimo de 160px que envuelve caóticamente los inputs del formulario en pantallas pequeñas.
   * **Ubicación en Código**: [PayrollUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/payroll/PayrollUI.js).
10. **Doble Scroll en Previsualización de Nómina**: La tabla de neto en el Paso 3 requiere scroll horizontal dentro de un contenedor colapsable vertical, dificultando su visualización.
    * **Ubicación en Código**: [PayrollUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/payroll/PayrollUI.js).

### Prioridad Baja (Detalles Visuales / Limpieza Estética)

1. **Redundancia del año "2026"**: Repetición innecesaria del año en las cabeceras de la tabla semanal que ensancha las columnas y congestiona visualmente la interfaz.
   * **Ubicación en Código**: [AttendanceUI.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/ui/AttendanceUI.js#L746-L751).
2. **Superposición de Notificación de Versión**: Alerta de actualización descolocada en el DOM que interfiere con el wizard inicial en el primer inicio.
   * **Ubicación en Código**: [index.html](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/index.html) e inicialización del Service Worker.
3. **Menú de navegación inferior rígido en Escritorio**: Barra base móvil usada en pantallas de 1440px, obligando a mover el cursor a la base del monitor y perdiendo espacio de pantalla útil.
   * **Ubicación en Código**: [navigation.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/navigation.css) y [styles.css](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/css/styles.css).
4. **Metadato de salario diario a cero**: Muestra `$0/día` para trabajadores con sueldo mensual en la tarjeta de Personal.
   * **Ubicación en Código**: [EmployeesList.js](file:///c:/Users/the_b/OneDrive - Universidad Autonoma de Santo Domingo/Educacion/Independiente/control de asistencia mini/aplicacionFull/js/modules/features/employees/EmployeesList.js).

---

## 3. Puntos de Oportunidad y Propuesta de Rediseño (Desktop)

En pantallas grandes, el diseño SPA móvil estirado genera una mala experiencia de usuario. Para optimizar el espacio horizontal y dotar a la aplicación de un aspecto más profesional de escritorio, se proponen dos mejoras estructurales:

### Propuesta A: Menú de Navegación Lateral (Sidebar)
En lugar de una barra de pestañas inferior de 80px de alto estirada horizontalmente, podemos utilizar una barra lateral izquierda compacta de 240px de ancho. Esto mantiene las secciones a la vista, libera espacio vertical y alinea la app con los patrones comunes de software empresarial.

### Propuesta B: Estructura de Doble Panel (Split View Dashboard)
En resoluciones superiores a 1024px, podemos dividir el espacio principal en un layout de rejilla de dos columnas principales:
* **Columna Izquierda (60%)**: Contiene la lista de asistencia del día en formato de tabla compacta, permitiendo visualizar a más de 12 trabajadores simultáneamente.
* **Columna Derecha (40%)**: Muestra de forma fija o interactiva el perfil del empleado seleccionado (su historial, saldos de préstamos y notas recientes) sin necesidad de abrir un modal que bloquee la pantalla principal.

### Boceto ASCII de Diseño de Pantalla de Escritorio Optimizado

```
+-----------------------------------------------------------------------------+
|  CONSTRUCTORA HORIZON S.R.L.                  [Usuario] [Nube] [Exportar]   |
+-----------------------------------------------------------------------------+
| NAVIGATION  |  ASISTENCIA DIARIA - Lun, 25 May 2026                         |
|             |  +---------------------+ +---------------------------------+  |
| [ ] Diario  |  | TARJETAS KPI        | | DETALLE EMPLEADO SELECCIONADO   |  |
| [x] Semanal |  | [P: 0] [A: 5] [H: 0]| | Juan Perez - Albañil            |  |
|             |  +---------------------+ |                                 |  |
| [ ] Personal|  | BUSCAR / FILTROS    | |  * Salario MTD: $31,200.00      |  |
|             |  | [ Buscar... ] [Pos] | |  * Dias Trabajados: 20          |  |
| [ ] Reportes|  +---------------------+ |  * Horas Acumuladas: 160h       |  |
|             |  | LISTA TRABAJADORES  | |                                 |  |
| [ ] Nomina  |  | 001 Juan Perez  [X] | |  HISTORIAL RECIENTE             |  |
|             |  | 002 Carlos Lopez[ ] | |  - Lun 25 May: Presente (8h)    |  |
| [ ] Ajustes |  | 003 Miguel R.   [ ] | |  - Dom 24 May: Feriado (0h)     |  |
|             |  | 004 Pedro M.    [ ] | |  - Sab 23 May: Presente (8h)    |  |
|             |  | 005 Luis G.     [ ] | |                                 |  |
|             |  | 006 Maria E.    [ ] | |  [ Editar ] [ Registrar Nota ]  |  |
|             |  +---------------------+ +---------------------------------+  |
+-------------+---------------------------------------------------------------+
|  Ver. 1.6.7 · Actualizado: 2026-05-19                                       |
+-----------------------------------------------------------------------------+
```

Este diseño redistribuye el espacio horizontal permitiendo que toda la información crítica del negocio esté accesible en un solo vistazo, eliminando clics innecesarios y la sensación de vacío que tiene la interfaz actual en ordenadores de sobremesa.
