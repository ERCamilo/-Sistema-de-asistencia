# Directriz del Sistema de Diseño (Design System)
### Control de Asistencia · Contrutek
**Referencia Canónica**: `Onboarding-funcional.html` (Onboarding v2)

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

### 5.4 Tarjetas de Selección Táctil (Radio Cards)
**Nunca usar radio buttons diminutos del navegador.**
* Tarjeta completa clickeable con `padding: 16px 18px`, `border-radius: 14px`, transición de fondo y borde.
* Caja de icono cuadrada: `40x40px`, radio `11px`, fondo `var(--panel-2)`, borde `1px solid var(--border)`.
* **Estado inactivo**: Fondo transparente, borde `var(--border)`.
* **Estado activo / seleccionado**: Fondo `var(--panel-2)`, borde `1px solid var(--accent)`. La caja de icono se llena de color cian (`var(--accent)`) con icono en `--on-accent`.

### 5.5 Steppers Numéricos y Presets
Para valores como horas o cantidades:
* Botones redondos/cuadrados de `+` y `−` de `44x44px` con borde `var(--border)`.
* Cifra central grande en `IBM Plex Mono` de `38px` bold con leyenda pequeña inferior (`por día` / `horas`).
* Botones de preset rápido al lado (ej. `8h`, `9h`, `10h`) con radio `9px` y altura `36px`.

### 5.6 Tarjetas de Previsualización en Tiempo Real (Live Mirroring)
Al escribir en un input (ej. nombre de empresa o cargo), debajo se renderiza una tarjeta con fondo `var(--panel-2)`, borde izquierdo con acento de color (`border-left: 3px solid var(--accent)`), que refleja instantáneamente el valor tecleado sin demora.

### 5.7 Footer Canónico de Navegación
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
   * Vista en tabla con estética limpia, chips de estado de 26px (`✓` verde, `✕` rojo, `!` naranja), selector inline de horas y botón `Volver a la vista general`.
5. **Paso 4: Resumen Final**:
   * Estilo `readySection`: Gran check verde circular animado con `popIn`, resumen de filas aprobadas e ignoradas en caja estilizada, y botón definitivo `Aplicar asistencia a SA`.
