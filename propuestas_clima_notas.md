# 🌤️ Pronóstico + Notas del Día — Propuestas de Diseño

## Contexto

El sistema de asistencia se usa en una empresa de construcción donde el clima impacta directamente la planificación del trabajo. Se propone integrar pronóstico meteorológico y notas diarias para mejorar la toma de decisiones.

---

## Propuesta A: Banner Compacto en la Vista de Asistencia

El pronóstico aparece como una **franja fija** entre los controles de fecha y la lista de empleados. Ocupa mínimo espacio pero siempre está visible.

### 📱 Móvil — Vista diaria

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 de Abril, 2026  ▶    │  ← Navpill existente
├─────────────────────────────────────┤
│ ⛈️ Lluvia fuerte          28°C     │  ← Banner clima
│ 💧 85% precip. · 💨 15km/h         │
│                                     │
│  Sáb   Dom   Lun   Mar   Mié       │  ← Mini pronóstico 5 días
│  ☀️    🌤️    ⛅    🌧️    ☀️       │
│  30°   29°   27°   24°   31°       │
├─────────────────────────────────────┤
│ 📝 "Suspendido vaciado por lluvia"  │  ← Nota del día (tap para editar)
├─────────────────────────────────────┤
│  👷 Presentes: 12  Ausentes: 3     │  ← Stats existente
│  ⏱️ 96h totales   🌙 4h extras     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ ☑️  Juan Pérez      8.0h   │    │  ← Lista empleados
│  │ ☑️  María López     9.5h   │    │
│  │ ☐  Pedro Ruiz       —      │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### 📱 Móvil — Cuando no hay internet

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 de Abril, 2026  ▶    │
├─────────────────────────────────────┤
│  🌐 Sin pronóstico disponible       │  ← Gris, discreto, no intrusivo
├─────────────────────────────────────┤
│  👷 Presentes: 12  Ausentes: 3     │
```

### ✅ Ventajas
- **Siempre visible** sin acción extra del usuario
- No cambia la navegación existente (sin pestaña nueva)
- Se degrada elegantemente sin internet

### ❌ Desventajas
- Ocupa ~80px verticales permanentemente
- En días que no importa el clima, es ruido visual
- El mini pronóstico de 5 días puede sentirse apretado en móvil

---

## Propuesta B: Tarjeta Desplegable (Collapsible)

El pronóstico vive en una **tarjeta colapsable** que el usuario abre/cierra. Por defecto cerrada, muestra solo un resumen de 1 línea.

### 📱 Móvil — Colapsado (estado por defecto)

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 de Abril, 2026  ▶    │
├─────────────────────────────────────┤
│  ⛈️ 28° Lluvia fuerte  📝 1 nota ▼ │  ← 1 línea, tap para expandir
├─────────────────────────────────────┤
│  👷 Presentes: 12  Ausentes: 3     │
│  ┌─────────────────────────────┐    │
│  │ ☑️  Juan Pérez      8.0h   │    │
```

### 📱 Móvil — Expandido

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 de Abril, 2026  ▶    │
├─────────────────────────────────────┤
│  ⛈️ 28° Lluvia fuerte  📝 1 nota ▲ │
│ ┌─────────────────────────────────┐ │
│ │  💧 85% precip. · 💨 15km/h    │ │
│ │  🌡️ Sensación: 31°C            │ │
│ │                                 │ │
│ │  Próximos días:                 │ │
│ │  ┌─────┬─────┬─────┬─────┬───┐ │ │
│ │  │ Sáb │ Dom │ Lun │ Mar │Mié│ │ │
│ │  │ ☀️  │ 🌤️ │ ⛅  │ 🌧️ │ ☀️│ │ │
│ │  │ 30° │ 29° │ 27° │ 24° │31°│ │ │
│ │  └─────┴─────┴─────┴─────┴───┘ │ │
│ │                                 │ │
│ │  📝 Nota del día:               │ │
│ │  ┌───────────────────────────┐  │ │
│ │  │ Suspendido vaciado por    │  │ │
│ │  │ lluvia. Se trabajó solo   │  │ │
│ │  │ en interiores.        [✏️]│  │ │
│ │  └───────────────────────────┘  │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│  👷 Presentes: 12  Ausentes: 3     │
```

### 🖥️ Desktop — Sidebar lateral

```
┌──────────────────────────────────────────────────────────┐
│  ◀  📅 Viernes 18 de Abril, 2026  ▶                     │
├────────────────────────────────┬─────────────────────────┤
│                                │  🌤️ Pronóstico          │
│  👷 Lista de Empleados         │  ⛈️ Lluvia fuerte  28°  │
│  ┌──────────────────────────┐  │  💧 85% · 💨 15km/h    │
│  │ ☑️ Juan Pérez    8.0h   │  │                         │
│  │ ☑️ María López   9.5h   │  │  Próximos 5 días:       │
│  │ ☐ Pedro Ruiz     —      │  │  Sáb ☀️ 30°            │
│  │ ☑️ Ana García    7.0h   │  │  Dom 🌤️ 29°            │
│  │ ☑️ Luis Torres   8.5h   │  │  Lun ⛅ 27°             │
│  │ ☑️ Rosa Díaz     6.0h   │  │  Mar 🌧️ 24°            │
│  └──────────────────────────┘  │  Mié ☀️ 31°             │
│                                │                         │
│                                │  📝 Nota del día:       │
│                                │  "Suspendido vaciado    │
│                                │   por lluvia"       [✏️]│
├────────────────────────────────┴─────────────────────────┤
```

### ✅ Ventajas
- **No ocupa espacio** cuando no lo necesitas (colapsado por defecto)
- Resumen de 1 línea siempre visible — suficiente para decision rápida
- En desktop aprovecha el espacio lateral
- La nota del día queda contextualizada con el clima

### ❌ Desventajas
- Requiere un tap extra para ver detalles
- Puede pasar desapercibido si el usuario no sabe que existe

---

## Propuesta C: Integrado en el Calendario del Navpill

Al abrir el calendario (click en la fecha), los días muestran iconos de clima y la nota aparece debajo del calendario.

### 📱 Móvil — Calendario expandido

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 de Abril, 2026  ▶    │
├─────────────────────────────────────┤
│  ┌──── Abril 2026 ────────────────┐ │
│  │ Dom  Lun  Mar  Mié  Jue Vie Sáb│ │
│  │                  1    2   3   4 │ │
│  │  5    6    7    8    9  10  11  │ │
│  │ 12   13   14   15   16  17  18  │ │
│  │ 19   20   21   ⛅   🌧️  ☀️ ☀️  │ │ ← Clima en días futuros
│  │ ☀️   🌤️  ⛅                    │ │
│  └─────────────────────────────────┘ │
│                                     │
│  🌤️ Hoy: Lluvia fuerte, 28°C       │
│  💧 85% precipitación              │
│                                     │
│  📝 "Suspendido vaciado"       [✏️] │
│                                     │
│  [       Cerrar Calendario       ]  │
├─────────────────────────────────────┤
│  👷 Lista de empleados...           │
└─────────────────────────────────────┘
```

### ✅ Ventajas
- **Contexto perfecto**: ves el clima y la nota justo cuando estás eligiendo qué día trabajar
- Los iconos de clima en el calendario dan visión de toda la semana de un vistazo
- No agrega elementos permanentes a la UI

### ❌ Desventajas
- **Solo visible cuando abres el calendario** — si no lo abres, no ves el clima
- El calendario se hace más pesado visualmente
- Requiere cargar el pronóstico solo cuando se abre (puede haber delay)

---

## Propuesta D: Header Contextual con Chip

Un **chip pequeño** junto al navpill de fecha que muestra solo el icono del clima. Al tocarlo, se abre un panel con detalles.

### 📱 Móvil — Estado normal

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 Abr  [⛈️ 28°]  ▶    │  ← Chip de clima integrado
├─────────────────────────────────────┤    en el navpill
│  👷 Presentes: 12  Ausentes: 3     │
│  ┌─────────────────────────────┐    │
│  │ ☑️  Juan Pérez      8.0h   │    │
```

### 📱 Móvil — Al tocar el chip ⛈️

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 Abr  [⛈️ 28°]  ▶    │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │  ⛈️ Lluvia fuerte              │ │  ← Panel flotante
│ │  🌡️ 28°C  💧 85%  💨 15km/h   │ │
│ │                                 │ │
│ │  Sáb  Dom  Lun  Mar  Mié       │ │
│ │  ☀️   🌤️   ⛅   🌧️   ☀️      │ │
│ │  30°  29°  27°  24°  31°       │ │
│ │                                 │ │
│ │  📝 Nota: Suspendido vaciado   │ │
│ │  por lluvia               [✏️] │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│  👷 Presentes: 12  Ausentes: 3     │
```

### ✅ Ventajas
- **Mínimo espacio**: solo un chip de ~50px en el header
- Información del clima visible de un vistazo (icono + temperatura)
- El detalle es bajo demanda
- No modifica la estructura existente

### ❌ Desventajas
- El chip puede competir visualmente con el navpill de fecha
- En pantallas muy pequeñas (<320px), el espacio es limitado

---

## Comparación Directa

| Criterio | A (Banner) | B (Collapsible) | C (Calendario) | D (Chip) |
|---|:---:|:---:|:---:|:---:|
| Espacio en pantalla | ❌ Alto | ✅ Bajo | ✅ Bajo | ✅ Mínimo |
| Visibilidad inmediata | ✅ Siempre | ⚠️ Solo resumen | ❌ Solo al abrir | ✅ Icono siempre |
| Complejidad técnica | 🟢 Baja | 🟡 Media | 🟡 Media | 🟢 Baja |
| Nota del día accesible | ✅ Sí | ✅ Sí (expand) | ⚠️ Solo al abrir cal. | ✅ Sí (panel) |
| Funciona sin internet | ✅ Oculta banner | ✅ Oculta card | ✅ No muestra iconos | ✅ Oculta chip |
| Impacto en layout existente | ⚠️ Empuja lista abajo | ✅ Mínimo | ✅ Ninguno | ✅ Mínimo |

---

## 🏆 Mi Recomendación: Propuesta D (Chip) + Elementos de B

La combinación óptima sería:

1. **Chip `[⛈️ 28°]`** integrado en el navpill → siempre visible, 0 espacio extra
2. **Al tocar** → panel flotante con pronóstico de 5 días + nota del día (como B expandido)
3. **En desktop** → el panel se muestra como sidebar fijo (como B desktop)

Esta combinación da:
- ✅ Información inmediata sin sacrificar espacio
- ✅ Detalle bajo demanda
- ✅ La nota del día queda vinculada al clima (contexto completo)
- ✅ Cero cambios en la estructura de navegación actual

### Datos a almacenar

```
state.dayNotes = {
    '2026-04-18': "Suspendido vaciado por lluvia",
    '2026-04-15': "Solo trabajo en interiores"
}

state.weatherCache = {
    lastFetch: '2026-04-18T08:00:00',
    location: { lat: 18.47, lon: -69.89 },
    forecast: [
        { date: '2026-04-18', icon: 'thunderstorm', temp: 28, rain: 85 },
        { date: '2026-04-19', icon: 'sunny', temp: 30, rain: 5 },
        ...
    ]
}

settings.weatherEnabled = true  // El usuario puede desactivarlo
settings.weatherLocation = { lat: 18.47, lon: -69.89, name: 'Santo Domingo' }
```

### API recomendada

**Open-Meteo** (https://open-meteo.com/) en vez de OpenWeatherMap:
- ✅ **Completamente gratis** — sin API key, sin registro
- ✅ Sin límite práctico de llamadas para uso individual
- ✅ Pronóstico de 7 días
- ✅ No requiere cuenta ni autenticación
- ⚠️ Menos precisa que servicios premium, pero suficiente para planificación

## Open Questions

> [!IMPORTANT]
> **1.** ¿Cuál de las 4 propuestas (o combinación) te parece más adecuada para tu uso diario?

> [!IMPORTANT]
> **2.** ¿Las notas del día deberían sincronizarse con Firebase (como la asistencia) o solo quedar en el dispositivo local?

> [!IMPORTANT]
> **3.** ¿La ubicación para el clima debería configurarse una sola vez en Ajustes, o usar la geolocalización automática del dispositivo cada vez?

> [!IMPORTANT]
> **4.** ¿Quieres tratar esto como proyecto separado o integrarlo al plan de períodos de pago? (Recomiendo separado — son features independientes)
