# Directriz del Sistema de Diseño (Design System)
### Control de Asistencia · Contrutek
**Referencia Canónica de comportamiento**: `Onboarding-funcional.html` (Onboarding v2). El HTML funcional original puede vivir fuera del repositorio; `design.md` debe conservar aquí sus reglas estables para que la guía no dependa de que ese archivo esté presente localmente.

Esta especificación documenta con exhaustividad y rigor de producción el lenguaje visual, la paleta de tokens OKLCH, los componentes interactivos, la ingeniería de animaciones y la psicología de interacción (UI/UX) que definen el producto.

Cualquier pantalla, modal, formulario o flujo (comenzando por el rediseño del importador de Mini) debe seguir esta guía **al pie de la letra** para garantizar la misma fluidez, velocidad de respuesta a 60 FPS, estética premium y simplicidad radical.

---

## 1. Filosofía de Interacción y Psicología de Usuario

### 1.1 "Cero Muros de Texto" (Self-Explanatory Affordance)
* **La regla de oro**: Si una pantalla necesita un párrafo para explicar cómo se usa, la interfaz está rota.
* Los botones nunca deben tener nombres ambiguos ni competir entre sí (ej. prohibido tener juntos *"Aceptar todos con Mini"*, *"Aceptar selección y continuar"* y *"Revisar todos los pendientes"*).
* Toda decisión se presenta como una **elección visual directa**: tarjetas grandes, interruptores táctiles o chips de estado autoevidentes.

### 1.2 Nivel de Comunicación y Microcopy
* **Kicker Chip**: Máximo 2 o 3 palabras en mayúsculas (`PUNTO DE PARTIDA`, `CONCILIACIÓN`, `PASO 1 · ASISTENCIA`).
* **Título H1**: Breve, imperativo o directo (`Tu obra, bajo control`, `¿Cómo quieres empezar?`, `Conciliación del reporte`).
* **Subtítulo**: Exactamente una línea que explica el beneficio inmediato.
* **Hints dinámicos en Footer**: Si el botón primario está deshabilitado, el centro del footer muestra en texto atenuado (`--text-faint`) la razón exacta (ej. `"Escribe un nombre para continuar"`, `"Selecciona al menos un día"`).
* **Alertas sin interrupciones**: Los errores o advertencias nunca disparan `alert()` ni ventanas emergentes; se renderizan como tarjetas sutiles inline con borde semántico y fondo traslúcido.

---

## 2. Sistema de Tokens (Tokens Visuales en OKLCH)

Se utiliza el espacio de color **OKLCH** para garantizar un contraste cromático perceptualmente uniforme en dispositivos móviles y de escritorio.

```css
:root {
  /* ================= Superficies y Fondos ================= */
  --bg:          oklch(0.185 0.012 245);  /* Fondo exterior / overlay (#0b1320) */
  --panel:       oklch(0.228 0.013 245);  /* Contenedor principal modal (#131d2e) */
  --panel-2:     oklch(0.268 0.014 245);  /* Superficies secundarias, inputs, cards (#1b273d) */
  --hover:       oklch(0.310 0.015 245);  /* Hover táctil / interactivo (#24334e) */
  --border:      oklch(0.330 0.014 245);  /* Bordes de división limpios (#2a3a56) */

  /* ================= Tipografía y Jerarquía ================= */
  --text:        oklch(0.960 0.004 245);  /* Texto principal (#f4f6fa) */
  --text-dim:    oklch(0.740 0.010 245);  /* Texto secundario / descripciones (#a4b1c7) */
  --text-faint:  oklch(0.560 0.012 245);  /* Metadatos, hints, códigos apagados (#6d7d99) */

  /* ================= Acento de Marca (Cian Eléctrico) ================= */
  --accent:      oklch(0.760 0.110 205);  /* Cian principal (#06b6d4 / oklch) */
  --on-accent:   oklch(0.160 0.020 240);  /* Texto/icono sobre fondo acento (#081a24) */

  /* ================= Semántica de Estado ================= */
  --good:        oklch(0.740 0.120 158);  /* Éxito / Presente / Listo (#10b981) */
  --warn:        oklch(0.820 0.110  78);  /* Advertencia / Atención / Feriado (#f59e0b) */
  --bad:         oklch(0.680 0.160  25);  /* Error / Ausente / Peligro (#ef4444) */

  /* ================= Elevación y Sombras ================= */
  --shadow:      0 1px 2px rgba(0,0,0,0.35), 0 24px 60px -24px rgba(0,0,0,0.8);
}
```

---

## 3. Tipografía y Escalas

* **Tipografía General**: `'IBM Plex Sans', system-ui, -apple-system, sans-serif`.
  * `H1`: `24px` a `27px`, `font-weight: 700`, `letter-spacing: -0.015em`, `line-height: 1.2`.
  * Párrafo descriptivo: `14px` a `14.5px`, `color: var(--text-dim)`, `line-height: 1.55`.
  * Labels de campos: `12px`, `font-weight: 600`, `color: var(--text-dim)`, `margin-bottom: 8px`.
* **Tipografía de Datos / Métricas**: `'IBM Plex Mono', monospace`.
  * Contadores y métricas grandes: `38px` o `26px`, `font-weight: 700`, `line-height: 1`.
  * Códigos de trabajador (ej. `001`): `font-size: 14px – 15px`, `font-weight: 600`.
  * Pasos e indicadores (ej. `1 / 4`): `font-size: 11.5px`, `color: var(--text-faint)`.

---

## 4. Ingeniería de Animaciones y Fluidez a 60 FPS

La experiencia fluida del onboarding se basa en una arquitectura de renderizado estricta:

### 4.1 La Regla `_noAnim` (Separación de Navegación vs. Interacción Interna)
* **Navegación entre pasos (Fresh Navigation)**:
  * Se activa `anim = true`. Las pantallas entran con `riseIn`, los badges con `popIn` escalonado (`stagger`).
* **Interacciones dentro de la pantalla (Toggles, typing, clics de opción)**:
  * Se activa `_noAnim = true`. **Cero re-animación de entrada, cero parpadeos, cero saltos de scroll**.
  * Solo el elemento que cambió recibe una microanimación localizada (`_action`).

### 4.2 Keyframes Canónicos
```css
/* Entrada con elevación suave */
@keyframes riseIn {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: none; }
}

/* Aparición simple sin desplazamiento */
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* Aparición pop elástica (checks, swatches, tarjetas activas) */
@keyframes popIn {
  0%   { opacity: 0; transform: scale(0.6); }
  60%  { transform: scale(1.06); }
  100% { opacity: 1; transform: scale(1); }
}

/* Entrada lateral en filas de listas */
@keyframes slideRow {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: none; }
}

/* Anillo expansivo de toque (Tactile Tap Ring) */
@keyframes tapRing {
  0%   { opacity: 0; transform: scale(0.5); }
  40%  { opacity: 0.7; }
  100% { opacity: 0; transform: scale(1.9); }
}

/* Expansión de barras de métricas o progreso */
@keyframes growW {
  from { width: 0; }
  to   { width: var(--w); }
}

/* Pulso de brillo en el fondo */
@keyframes glowPulse {
  0%, 100% { opacity: 0.22; transform: scale(1); }
  50%      { opacity: 0.42; transform: scale(1.1); }
}

/* Respiración sutil en iconos principales */
@keyframes breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.04); }
}
```

### 4.3 Contadores Numéricos Suavizados (`runCounters`)
Cuando una cifra cambia (ej. número de presentes o total de horas), el valor numérico no brinca de golpe; sube con una curva cúbica suave (`1 - Math.pow(1 - k, 3)`) durante ~800–1100ms mediante `requestAnimationFrame`, parcheando únicamente el nodo de texto sin repintar el DOM circundante.

---


### 4.4 Continuidad espacial: morphing entre pantallas y modales de distinto tamaño

Cuando una interacción pasa de una vista compacta a otra más alta/ancha (o viceversa), **no se desmonta el modal para crear otro**. El usuario debe percibir que el mismo objeto de interfaz se transforma.

Reglas obligatorias:
* Mantener montados el mismo overlay y el mismo shell del modal durante toda la transición. Cambiar contenido dentro del shell, no reemplazar overlay + modal en un frame distinto.
* Medir el rectángulo actual y el rectángulo destino (`getBoundingClientRect`) y animar el shell entre ambos. El ancho y alto objetivo se expresan temporalmente en píxeles para que `height:auto` no provoque un salto.
* Duración orientativa del cambio geométrico: **220–320 ms**, con `cubic-bezier(.2,.8,.2,1)`. Cambios pequeños pueden usar 180–220 ms; cambios grandes no deben superar ~360 ms.
* El contenido anterior puede bajar a `opacity:0` durante ~80–120 ms mientras el shell empieza a transformarse; el contenido nuevo entra con `opacity` + `translateY(6px)` durante ~140–200 ms. No debe existir un frame vacío/blanco entre ambos.
* `border-radius`, padding y divisiones internas pueden interpolarse junto con el tamaño si cambian entre variantes compacta/media/ancha.
* En desktop el anclaje visual preferido es el centro del shell. En bottom sheets móviles, el borde inferior permanece visualmente anclado y el crecimiento sucede principalmente hacia arriba.
* El overlay **no parpadea, no desaparece y no reinicia su opacidad** al cambiar entre pasos del mismo flujo.
* El foco lógico se transfiere sólo después de que el contenido destino exista; si el control equivalente continúa, se preserva el foco. Nunca enviar el foco a `body` durante la transición.
* Mantener el scroll del área que no cambia. Si el siguiente paso necesita reset de scroll, hacerlo al finalizar el morph, no antes.
* Interacciones internas que no cambian la arquitectura del panel siguen usando `_noAnim = true`; el morph se reserva para navegación/expansión estructural.
* Con `prefers-reduced-motion: reduce`, aplicar el estado destino inmediatamente pero conservar el mismo shell/overlay para evitar el efecto de parpadeo.

Patrón recomendado (FLIP/medición doble):
```js
async function morphModal(shell, renderNext) {
  const from = shell.getBoundingClientRect();
  shell.style.width = `${from.width}px`;
  shell.style.height = `${from.height}px`;

  renderNext(); // mismo shell; cambia sólo su interior
  const prevTransition = shell.style.transition;
  shell.style.transition = 'none';
  shell.style.width = '';
  shell.style.height = 'auto';
  const to = shell.getBoundingClientRect();

  shell.style.width = `${from.width}px`;
  shell.style.height = `${from.height}px`;
  shell.getBoundingClientRect(); // commit del estado inicial
  shell.style.transition = 'width .26s cubic-bezier(.2,.8,.2,1), height .26s cubic-bezier(.2,.8,.2,1)';
  shell.style.width = `${to.width}px`;
  shell.style.height = `${to.height}px`;

  await waitForTransition(shell);
  shell.style.width = '';
  shell.style.height = '';
  shell.style.transition = prevTransition;
}
```
La implementación real puede usar Web Animations API o FLIP, pero debe preservar estas propiedades perceptuales: **mismo objeto, continuidad geométrica, cero flash y cero salto de foco**.

### 4.5 Detalles del onboarding funcional que también forman parte del contrato

El `Onboarding-funcional.html` original aporta además los siguientes patrones que deben conservarse en flujos equivalentes:
* `fadeIn` es un keyframe canónico adicional para elementos cuya aparición no requiere desplazamiento.
* La guía puede usar composición de **dos columnas** (explicación + demo viva) en pantallas amplias y pasar a **una sola columna a 860 px o menos**. El demo cambia de borde lateral a borde superior para mantener continuidad visual.
* El shell principal permanece centrado sobre un fondo único de viewport completo; la navegación entre fases cambia el contenido interior sin sustituir el contexto visual completo.
* Seleccionar una tarjeta puede revelar información contextual **dentro de la misma tarjeta** (por ejemplo, detalle de backup/Google) en vez de abrir inmediatamente otro modal.
* El estado de navegación del onboarding se persiste de forma ligera para poder continuar donde se dejó, pero se limpia al completar el flujo.
* Los cambios reactivos de inputs, días, horas y estados usan rerender sin animación global (`_noAnim`) y sólo el elemento afectado recibe una microanimación mediante `_action`.
* El cursor/selección de texto se captura antes del rerender y se restaura con `setSelectionRange()` después del render.
* La animación de datos debe parchear únicamente nodos numéricos (`requestAnimationFrame`) cuando sea posible; no se vuelve a animar el contenedor completo por cada cambio.
* El flujo finaliza con una pantalla de resumen/ready que sintetiza decisiones previas antes de entrar a la aplicación.

## 5. Catálogo de Componentes de Interfaz

### 5.1 Shell Modal / Ventana Principal
* Contenedor con `border-radius: 22px`, fondo `var(--panel)`, borde `1px solid var(--border)`, sombra `var(--shadow)` y `overflow: hidden`.
* Ancho responsivo: `max-width: 980px` (pantallas de 2 columnas o con tabla) o `max-width: 620px` (pantallas de selección o formulario centrado).

### 5.2 Topbar con Barra de Progreso Reactiva
* **Padding**: `18px 26px`.
* **Identidad**: Icono redondeado (30x30px, radio 8px), título de app (`13.5px`, font-weight 600) y subtítulo (`11px`, `--text-faint`).
* **Lado derecho**: Indicador de paso en monospace (ej. `2 / 4`) y botón discreto para omitir o volver.
* **Barra inferior**: Línea de `2px` o `3px` pegada al borde inferior:
  ```html
  <div style="position:absolute;left:0;bottom:-1px;height:2px;width:50%;background:var(--accent);transition:width .3s;"></div>
  ```

### 5.3 Chip / Kicker de Sección
Etiqueta superior que sitúa al usuario:
```html
<div style="display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 11px;border-radius:20px;background:var(--panel-2);border:1px solid var(--border);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--accent);margin-bottom:16px;">
  PUNTO DE PARTIDA
</div>
```

### 5.4 Etiquetas de Estado y Resolución
Las etiquetas de estado deben comunicar el significado de un vistazo y conservar contraste suficiente sobre fondos oscuros.

* **Regla visual obligatoria**: no usar el patrón de etiqueta con fondo transparente + borde semántico + texto del mismo color. Para estados como `Nuevo`, `Conflicto`, `Advertencia`, `Error` o `Incorporado`, usar un **relleno sólido del color semántico** y texto/icono claro de alto contraste.
* **Colores**: `--good` para éxito/listo, `--warn` para conflicto/atención, `--bad` para error/bloqueo y `--accent` para novedad/estado informativo. El borde, si existe, debe usar el mismo token o valor derivado que el relleno; no debe verse como un contorno separado ni ser el recurso visual principal.
* **Texto sobre color**: preferir blanco o un token `on-*` con contraste equivalente. Sobre `--accent`, usar `--on-accent`; sobre `--good`, `--warn` o `--bad`, usar un tono claro que cumpla contraste AA.
* **Forma**: altura aproximada `24px–28px`, `padding: 4px 9px`, `border-radius: 999px`, `font-size: 11px–12px`, `font-weight: 700`.
* **No depender sólo del color**: conflictos y advertencias deben conservar texto o iconografía que explique el estado.
* **Estado resuelto/completado**: en filas o listas repetitivas, no mostrar una píldora de texto `Resuelto`. Usar un **SVG checkmark** claro y accesible (`aria-label="Resuelto"` o texto visualmente oculto). En filas repetitivas usar por defecto el check SVG simple, sin píldora, círculo ni fondo propio; reservar contenedores adicionales sólo para casos excepcionales definidos por el sistema de diseño.
* **Estado nuevo**: usar una etiqueta sólida `Nuevo` con `--accent` y texto `--on-accent`.
* **Estado incorporado**: el registro completo puede verse atenuado (`opacity` aproximada `.55–.7`) para indicar que ya fue procesado; si se muestra una etiqueta adicional, debe seguir la misma regla de relleno sólido.
* **Consistencia**: el mismo estado debe conservar color, icono y redacción en toda la aplicación; no alternar entre borde-only, chip sólido y texto plano para el mismo significado.
* **Bandejas con ciclo de vida**: cuando una importación use una bandeja persistente, distinguir al menos `Nuevo` (recibido y aún no revisado), `No incorporado` (ya revisado/consolidado pero no aplicado) e `Incorporado` (flujo completado y confirmado). El estado debe persistirse; no debe depender sólo de una clase CSS temporal.
* **Nuevos**: usar chip sólido de acento y mantenerlo visible hasta que el borrador entre realmente a revisión/consolidación.
* **Incorporados**: atenuar la tarjeta completa (`opacity` aproximada `.55–.7`) y desactivar acciones que volverían a aplicar el mismo borrador por accidente. Debe seguir siendo legible para consulta/auditoría.
* **Filtros de bandeja**: ofrecer filtros por `Todos`, `Nuevos`, `No incorporados` e `Incorporados`, más orden por fecha de trabajo y fecha de actualización/recepción. En listas temporales se prioriza lo más reciente.
* **Finalización explícita**: aplicar datos y completar una importación son acciones distintas. Después de aplicar todos los días, mostrar un botón `Completar importación`; sólo esta acción cambia los borradores a `Incorporado`.
* **Filas resueltas**: en listas de empleados repetitivas, sustituir la píldora textual `Resuelto` por un SVG checkmark accesible. El significado accesible se conserva con `aria-label` o texto oculto.
* **Separación entre personas**: cuando varios empleados pertenezcan al mismo día, cada empleado debe sentirse como una unidad visual distinta mediante espacio, fondo, borde/radio o divisor claro; no depender únicamente de una línea fina continua que haga parecer todo una sola tabla.

### 5.5 Tarjetas de Selección Táctil (Radio Cards)
**Nunca usar radio buttons diminutos del navegador.**
* Tarjeta completa clickeable con `padding: 16px 18px`, `border-radius: 14px`, transición de fondo y borde.
* Caja de icono cuadrada: `40x40px`, radio `11px`, fondo `var(--panel-2)`, borde `1px solid var(--border)`.
* **Estado inactivo**: Fondo transparente, borde `var(--border)`.
* **Estado activo / seleccionado**: Fondo `var(--panel-2)`, borde `1px solid var(--accent)`. La caja de icono se llena de color cian (`var(--accent)`) con icono en `--on-accent`.

### 5.6 Steppers Numéricos y Presets
Para valores como horas o cantidades:
* Botones redondos/cuadrados de `+` y `−` de `44x44px` con borde `var(--border)`.
* Cifra central grande en `IBM Plex Mono` de `38px` bold con leyenda pequeña inferior (`por día` / `horas`).
* Botones de preset rápido al lado (ej. `8h`, `9h`, `10h`) con radio `9px` y altura `36px`.

### 5.7 Tarjetas de Previsualización en Tiempo Real (Live Mirroring)
Al escribir en un input (ej. nombre de empresa o cargo), debajo se renderiza una tarjeta con fondo `var(--panel-2)`, borde izquierdo con acento de color (`border-left: 3px solid var(--accent)`), que refleja instantáneamente el valor tecleado sin demora.

### 5.8 Footer Canónico de Navegación
* **Padding**: `16px 26px`, borde superior `1px solid var(--border)`.
* **Botón Atrás**: Altura `40px` a `42px`, transparente, texto `var(--text-dim)` con flecha SVG izquierda. Si está deshabilitado en el paso 1: `opacity: .35; pointer-events: none;`.
* **Centro**: Paginación con puntos (`dots`) o hint contextual en `--text-faint`.
* **Botón Siguiente (Primario)**: Altura `40px` a `42px`, fondo `var(--accent)`, texto `var(--on-accent)`, `font-weight: 600`, radio `10px`, con flecha derecha o check SVG. Si el paso no es válido para avanzar: `opacity: .4; pointer-events: none;`.

---

## 6. Clases Utilitarias (Hover & Interactions)

Para asegurar interactividad táctil sin CSS inline engorroso:
```css
.hv-bg:hover       { background: var(--hover) !important; }
.hv-bright:hover   { filter: brightness(1.08); }
.hv-text:hover     { color: var(--text) !important; }
.hv-bdim:hover     { border-color: var(--text-dim) !important; }
.hv-bgtext:hover   { background: var(--hover) !important; color: var(--text) !important; }
.hv-danger:hover   { color: var(--bad) !important; border-color: var(--bad) !important; }
```

---

## 7. Navegación por Teclado y Accesibilidad (A11y)

* **Atajos de teclado activos en todo momento**:
  * `Flecha Derecha` / `Flecha Abajo`: Avanza al siguiente paso (si `canAdvance()` es verdadero).
  * `Flecha Izquierda` / `Escape`: Vuelve al paso anterior o cierra.
  * `Enter`: Si se está escribiendo en un input, agrega el registro o avanza si el paso es válido.
* **Foco visible accesible**:
  `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }`
* **Preservación del cursor**: Durante actualizaciones reactivas continuas, la posición del cursor de texto se preserva con `setSelectionRange()`.

---

## 8. Aplicación al Rediseño del Importador de Mini

Siguiendo esta directriz, el flujo de Mini se rediseña así:

1. **Paso 1: Pegado**:
   * Textarea estilizado en `var(--panel-2)` con bordes `var(--border)` y botón primario cian `Analizar reporte →`.
2. **Paso 2: Validación**:
   * Tarjeta limpia centrada estilo `setupSection`: chip `VALIDACIÓN`, fecha detectada en grande, badge con total de empleados, selector de jornada con botones `8h` / `Normales`. Botón `Continuar →`.
3. **Paso 3: Tarjeta Ejecutiva de Conciliación**:
   * Chip `CONCILIACIÓN`.
   * Tarjeta con dos bloques de estado:
     * 🟢 `N empleados listos`: Coincidencia exacta sin conflictos.
     * 🟡 `M empleados con conflicto`: Diferencias de horas, inactivos o sin cargo.
   * Botón secundario en la tarjeta: `Inspeccionar listado completo en tabla →` (abre la pantalla 3b detallada).
   * Botón primario cian del footer: `Resolver M pendientes →` (o `Ir al resumen final →`).
4. **Paso 3b: Pantalla de Tabla Detallada y Resolución (Pantalla completa independiente)**:
   * Vista en tabla con estética limpia, selector inline de horas y separación visual clara entre empleados. Los estados de conflicto usan etiquetas **sólidas** con relleno semántico y texto claro; los estados resueltos usan un **SVG checkmark** en lugar de una etiqueta textual `Resuelto`. Botón `Volver a la vista general`.
5. **Paso 4: Resumen Final**:
   * Estilo `readySection`: Gran check verde circular animado con `popIn`, resumen de filas aprobadas e ignoradas en caja estilizada, y botón definitivo `Aplicar asistencia a SA`.
