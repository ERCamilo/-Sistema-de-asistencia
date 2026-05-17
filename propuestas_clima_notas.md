# 🌤️ Sistema de Clima + Notas Diarias

> **Estado:** 📋 **PROPUESTA / FUNCIONALIDAD FUTURA**
> No implementado. Documento de diseño para evaluación e implementación en versiones posteriores.
>
> **Última revisión:** 2026-05-17
> **Prioridad sugerida:** Media — útil pero no bloqueante para operación actual
> **Esfuerzo estimado (MVP):** 2-3 días de desarrollo + 1 día de pruebas

---

## 📑 Tabla de Contenidos

1. [Contexto y Motivación](#contexto-y-motivación)
2. [Casos de Uso](#casos-de-uso)
3. [Propuestas de Interfaz (4 opciones)](#propuestas-de-interfaz)
4. [Comparación de Propuestas UI](#comparación-de-propuestas-ui)
5. [Recomendación de Diseño](#recomendación-de-diseño)
6. [Comparación de APIs de Clima](#comparación-de-apis-de-clima)
7. [Recomendación de API](#recomendación-de-api)
8. [Arquitectura Técnica](#arquitectura-técnica)
9. [Plan de Implementación por Fases](#plan-de-implementación-por-fases)
10. [🔮 Visión a largo plazo: Clima como herramienta de gestión](#-visión-a-largo-plazo-clima-como-herramienta-de-gestión)
11. [Consideraciones de Privacidad y Seguridad](#consideraciones-de-privacidad-y-seguridad)
12. [Análisis de Costos](#análisis-de-costos)
13. [Preguntas Abiertas Resueltas](#preguntas-abiertas-resueltas)

---

## Contexto y Motivación

El sistema de asistencia se usa principalmente en **empresas de construcción en República Dominicana**, donde el clima impacta directamente:

- Días de lluvia fuerte → trabajo exterior suspendido
- Huracanes/tormentas tropicales → cierre completo
- Calor extremo → ajustes de horario y descansos
- Pronóstico → planificación semanal del trabajo

**Notas diarias** complementan al permitir documentar el "por qué" detrás de patrones de asistencia inusuales.

### Problemas que resuelve

1. **Decisiones uniformes**: jefes y administradores ven el mismo pronóstico
2. **Trazabilidad**: vincular ausencias masivas con eventos climáticos documentados
3. **Planificación**: organizar tareas según pronóstico de los próximos 5-7 días
4. **Justificación de pago**: en RD muchas empresas pagan días "trabajados aunque sea media jornada por lluvia"

---

## Casos de Uso

### Primario
> *"Como administrador, quiero ver el clima del día actual y el pronóstico de 5 días para planificar las tareas de la semana."*

### Secundarios
1. *"Cuando llueve fuerte, quiero anotar 'Suspendido vaciado por lluvia' en el día para que aparezca en el reporte de nómina."*
2. *"Quiero recibir una alerta el día anterior si se pronostica lluvia fuerte, para avisar a la cuadrilla."*
3. *"Al ver el historial de un empleado, quiero ver si sus ausencias coinciden con días de mal tiempo."*
4. *"Tengo dos obras en sitios distintos (Santo Domingo y Punta Cana). Necesito ver el clima de cada una."*

---

## Propuestas de Interfaz

### Propuesta A: Banner Compacto

Franja fija entre el navpill de fecha y la lista de empleados.

```
┌─────────────────────────────────────┐
│  ◀  📅 Vie 18 de Abril, 2026  ▶    │
├─────────────────────────────────────┤
│ ⛈️ Lluvia fuerte          28°C     │
│ 💧 85% precip. · 💨 15km/h         │
│                                     │
│  Sáb   Dom   Lun   Mar   Mié       │
│  ☀️    🌤️    ⛅    🌧️    ☀️       │
│  30°   29°   27°   24°   31°       │
├─────────────────────────────────────┤
│ 📝 "Suspendido vaciado por lluvia"  │
├─────────────────────────────────────┤
│  👷 Presentes: 12  Ausentes: 3     │
```

**Pros:** Siempre visible, sin acción extra
**Contras:** Ocupa ~120px verticales permanentemente

---

### Propuesta B: Tarjeta Desplegable

Por defecto cerrada (1 línea), expandible al tocar.

```
[Colapsado]
│  ⛈️ 28° Lluvia fuerte  📝 1 nota ▼ │

[Expandido]
│  ⛈️ 28° Lluvia fuerte  📝 1 nota ▲ │
│ ┌─────────────────────────────────┐ │
│ │  💧 85% precip. · 💨 15km/h    │ │
│ │  🌡️ Sensación: 31°C            │ │
│ │  Sáb ☀️ 30°  Dom 🌤️ 29°       │ │
│ │  Lun ⛅ 27°  Mar 🌧️ 24°       │ │
│ │  📝 Suspendido vaciado    [✏️]  │ │
│ └─────────────────────────────────┘ │
```

**Pros:** Cero espacio cuando no se usa, resumen siempre visible
**Contras:** Tap extra para detalles

---

### Propuesta C: Integrado en el Calendario

Iconos de clima en los días al abrir el calendario del navpill.

```
│  ┌──── Abril 2026 ────────────────┐ │
│  │ 19   20   21   ⛅   🌧️  ☀️ ☀️  │ │
│  │ ☀️   🌤️  ⛅                    │ │
│  └─────────────────────────────────┘ │
│  🌤️ Hoy: Lluvia fuerte, 28°C       │
│  📝 "Suspendido vaciado"       [✏️] │
```

**Pros:** Contexto al elegir día
**Contras:** Solo visible al abrir calendario

---

### Propuesta D: Header Contextual con Chip ⭐

Chip pequeño junto al navpill que despliega panel al tocarlo.

```
[Normal]
│  ◀  📅 Vie 18 Abr  [⛈️ 28°]  ▶    │

[Al tocar el chip]
│  ◀  📅 Vie 18 Abr  [⛈️ 28°]  ▶    │
│ ┌─────────────────────────────────┐ │
│ │  ⛈️ Lluvia fuerte              │ │
│ │  🌡️ 28°C  💧 85%  💨 15km/h   │ │
│ │  Sáb ☀️ 30°  Dom 🌤️ 29°       │ │
│ │  📝 Nota: Suspendido [✏️]      │ │
│ └─────────────────────────────────┘ │
```

**Pros:** Mínimo espacio (50px), info de un vistazo, no modifica navegación
**Contras:** Chip puede competir visualmente en pantallas <320px

---

## Comparación de Propuestas UI

| Criterio | A: Banner | B: Collapsible | C: Calendario | D: Chip |
|---|:---:|:---:|:---:|:---:|
| Espacio en pantalla | ❌ Alto | ✅ Bajo | ✅ Bajo | ✅ Mínimo |
| Visibilidad inmediata | ✅ Siempre | ⚠️ Solo resumen | ❌ Solo al abrir | ✅ Icono siempre |
| Complejidad técnica | 🟢 Baja | 🟡 Media | 🟡 Media | 🟢 Baja |
| Nota del día accesible | ✅ Sí | ✅ Sí (expand) | ⚠️ Solo al abrir cal. | ✅ Sí (panel) |
| Sin internet | ✅ Oculta banner | ✅ Oculta card | ✅ Sin iconos | ✅ Oculta chip |
| Impacto en layout actual | ⚠️ Empuja lista | ✅ Mínimo | ✅ Ninguno | ✅ Mínimo |
| Compatible con vista semana | ⚠️ Repetir info | ✅ Sí | ✅ Sí | ✅ Sí |
| Mobile-first (<375px) | ⚠️ Amontonado | ✅ OK | ✅ OK | ⚠️ Apretado |

---

## Recomendación de Diseño

### 🏆 Híbrido: **D + B** (Chip + Panel tipo collapsible)

1. **En móvil**:
   - Chip `[⛈️ 28°]` en el navpill (siempre visible)
   - Al tocar → panel flotante con pronóstico de 5 días + nota del día
   - Si no hay internet → chip queda en estado `[🌐 Sin clima]` discreto

2. **En desktop** (≥1024px):
   - Sidebar lateral fija (240px) con pronóstico expandido + nota
   - Sin chip — el sidebar reemplaza esa función

3. **Nota del día**:
   - Visible/editable en el panel desplegado
   - Persiste en Firebase como `state.dayNotes[dateKey]`
   - Aparece en reportes de nómina como justificación

### Razones de esta elección

- ✅ **Cero impacto** en la estructura actual del navpill
- ✅ **Información a la vista** sin sacrificar espacio
- ✅ **Detalle bajo demanda** (no satura usuarios que no lo necesitan)
- ✅ **Mobile-first** (la mayoría de usuarios usan móvil)
- ✅ **Degrada elegantemente** sin internet

---

## Comparación de APIs de Clima

> **Investigación actualizada a 2025-2026**. Las cuotas y precios cambian; verificar antes de implementar.

| API | Free tier | Tarjeta requerida | Días forecast (free) | Cobertura RD | Notas |
|---|---|---|---|---|---|
| **Google Weather API** | 10,000 calls/mes por SKU | ✅ Sí (Cloud Billing) | 10 días | ✅ Excelente | Preview/pre-GA (mar 2025), integración natural con Firebase |
| **OpenWeatherMap (clásico)** | 1,000 calls/día | ❌ No | 5 días (3h res) | ✅ Buena | Plan One Call 3.0 sí requiere tarjeta — ¡cuidado! |
| **WeatherAPI.com** | **1,000,000 calls/mes** | ❌ No | 3 días | ✅ Buena | El free tier más generoso sin tarjeta |
| **Open-Meteo** | <10,000 calls/día | ❌ No | 16 días | ✅ Excelente | ⚠️ **Licencia NO comercial** — bloquea SaaS pago |
| **Tomorrow.io** | 500 calls/día | ❌ No | Sí (hyperlocal) | ✅ Buena | Plan free muy ajustado |
| **AccuWeather** | 50 calls/día | ❌ Free / ✅ Pago desde ~$25/mes | 5 días | ✅ Excelente (Caribe) | Tradición fuerte en huracanes |

### Hallazgos críticos

> ⚠️ **Open-Meteo no se puede usar comercialmente en el plan gratis.** Aunque la propuesta original lo recomendaba, su licencia CC BY 4.0 prohíbe uso comercial. Si la app cobra suscripción o muestra publicidad, viola los términos.

> ⚠️ **OpenWeatherMap One Call 3.0 requiere tarjeta** aunque uses solo el free tier — riesgo de cobros sorpresa si excedes.

> ✅ **Google Weather API + Firebase** tiene sinergia natural ya que la app ya usa Firebase. La key se puede gestionar desde la misma consola de Google Cloud.

---

## Recomendación de API

### Las 3 mejores opciones para este caso, en orden de preferencia

---

### 🥇 1. WeatherAPI.com — **La mejor para EMPEZAR**

**Por qué elegirla:** la más **predecible y segura** para arrancar sin preocupaciones.

#### ✅ Ventajas
- **1 millón de llamadas/mes gratis** — el free tier más generoso del mercado
- **No requiere tarjeta de crédito** — cero riesgo de cobros sorpresa
- Registro simple (correo + verificación, 5 minutos)
- Cobertura sólida en República Dominicana
- Datos completos: temperatura, sensación térmica, precipitación, viento, calidad del aire, astronomía
- Plan de pago barato si crece ($4/mes = 3M calls)
- Histórico de clima desde 2010 disponible

#### ❌ Desventajas
- Solo **3 días de pronóstico** en el free tier (14 días en planes pagos)
- Menos prestigio que Google/AccuWeather
- Soporte técnico menor que las grandes
- Sin endpoint oficial de alertas tropicales fuertes

#### 🎯 Ideal cuando
- Estás empezando y no sabes si la feature será adoptada
- No quieres lidiar con Cloud Billing de Google
- Te basta con clima de hoy + 2-3 días de pronóstico
- Valoras documentación clara y simple

#### 🚫 NO ideal cuando
- Necesitas pronóstico de 7+ días
- Necesitas alertas oficiales de huracanes
- Vas a escalar a 10,000+ usuarios sin caché

---

### 🥈 2. Google Weather API — **La mejor para PRODUCCIÓN seria**

**Por qué elegirla:** **sinergia natural con tu stack actual** (ya usas Firebase, que es Google Cloud).

#### ✅ Ventajas
- **10 días de pronóstico** en el free tier
- Integración trivial: misma consola, misma facturación, mismo soporte
- **Endpoint de alertas oficiales** (agregado nov 2025) — crítico para temporada de huracanes en RD
- Datos hyperlocales con resolución alta
- Documentación de calidad enterprise
- 10,000 llamadas/mes gratis por endpoint (current, hourly, daily, alerts)
- Calidad de modelo similar a la usada por Google Maps
- Soporte multilenguaje (español incluido)

#### ❌ Desventajas
- **Requiere habilitar Cloud Billing** (tarjeta de crédito) aunque uses solo el free tier
- Actualmente en **Preview/pre-GA** — pueden cambiar precios o estructura
- Configuración inicial más compleja (proyecto GCP, restricciones de key, etc.)
- Riesgo de cobros si excedes cuotas y no monitoreas
- Sin SDK oficial para web — solo REST

#### 🎯 Ideal cuando
- Tienes ≥500 usuarios activos
- Ya tienes proyecto Firebase configurado (ya lo tienes)
- Quieres alertas de huracanes/tormentas tropicales
- Necesitas pronóstico extendido (10 días)
- Vas a usar otros productos de Google Maps Platform (mapas, geocoding)

#### 🚫 NO ideal cuando
- No quieres dar tarjeta a Google
- El proyecto debe ser 100% gratuito sin riesgo
- Estás en fase exploratoria

---

### 🥉 3. OpenWeatherMap (clásico) — **El veterano confiable**

**Por qué elegirla:** la más conocida del ecosistema dev. Muchos ejemplos y librerías existentes.

#### ✅ Ventajas
- **1,000 llamadas/día gratis** (~30k/mes) sin tarjeta
- La más documentada y con más recursos en internet
- Comunidad masiva, muchas librerías y tutoriales
- 5 días de pronóstico (con resolución de 3 horas)
- Datos básicos completos (temp, precipitación, viento)
- Funciona en RD sin problemas

#### ❌ Desventajas
- **Trampa peligrosa**: el endpoint "One Call API 3.0" (el más útil) requiere tarjeta de crédito y puede cobrar
- Solo 5 días vs 10 de Google o 14 de WeatherAPI pago
- Free tier tiene rate limit (60 calls/min) — puede ser ajustado en momentos pico
- Sin alertas tropicales oficiales en el free tier
- Calidad reportada por desarrolladores: ligeramente menor que Google/AccuWeather

#### 🎯 Ideal cuando
- Quieres usar librerías existentes (hay muchas)
- Solo necesitas datos básicos
- Te quedas **estrictamente** en el plan clásico (NO One Call 3.0)

#### 🚫 NO ideal cuando
- **Si te tientan los endpoints One Call 3.0** — riesgo de cobros sorpresa
- Necesitas alertas o pronóstico extendido

---

## ⚠️ APIs descartadas explícitamente para este caso

### Open-Meteo (¡cuidado con esto!)

Aunque tiene cuotas muy generosas (10k/día, sin key, sin registro), **su licencia CC BY 4.0 prohíbe uso comercial**. Si la app cobra suscripción a empresas o tiene publicidad, **estás violando los términos legales**.

> 🚨 La propuesta original recomendaba Open-Meteo — esto era un **error**. Si decides usarla, asegúrate de que la app sea **100% gratuita sin monetización**, ahora y en el futuro.

### Tomorrow.io
- 500 calls/día es muy poco para crecimiento
- Planes pagos son caros (orientados a enterprise)
- Mejor para apps que necesitan datos hiper-locales (agricultura, eventos)

### AccuWeather como API principal
- 50 calls/día en free es ridículo para uso real
- Planes pagos desde ~$25/mes
- **Pero es excelente como complemento** para alertas de huracanes específicamente

---

## 📊 Tabla comparativa rápida

| Aspecto | 🥇 WeatherAPI.com | 🥈 Google Weather | 🥉 OpenWeatherMap |
|---|---|---|---|
| **Free tier real** | 1M/mes | 10k/mes/endpoint | 30k/mes |
| **Tarjeta requerida** | ❌ No | ✅ Sí | ❌ No (clásico) |
| **Días forecast (free)** | 3 | 10 | 5 |
| **Alertas tropicales** | ❌ No | ✅ Sí | ❌ No |
| **Setup inicial** | 🟢 5 min | 🟡 30 min | 🟢 10 min |
| **Riesgo de cobros** | 🟢 Cero | 🟡 Posible | 🟡 Si usas One Call |
| **Calidad RD** | 🟢 Buena | 🟢 Excelente | 🟢 Buena |
| **Para construcción** | 🟢 Suficiente | 🟢 Ideal | 🟢 OK |

---

## 🎯 Camino recomendado: estrategia evolutiva

```
┌────────────────────────────────────────┐
│  FASE MVP — Empezar con WeatherAPI.com │
│                                        │
│  • Registrarse (5 min)                 │
│  • API key gratis sin tarjeta          │
│  • Implementar chip + panel            │
│  • Caché 30min en IndexedDB            │
│  • Total: 1-2 días de trabajo          │
└────────────────────────────────────────┘
              ↓
   ¿Feature adoptada? ¿Crece usuarios?
              ↓
┌────────────────────────────────────────┐
│  FASE PRODUCCIÓN — Migrar a Google     │
│                                        │
│  • Habilitar Google Weather API en     │
│    tu proyecto Firebase actual         │
│  • Cambiar el adapter en               │
│    WeatherService (sin tocar UI)       │
│  • Total: 0.5 día                      │
└────────────────────────────────────────┘
              ↓
  ¿Temporada de huracanes (jun-nov)?
              ↓
┌────────────────────────────────────────┐
│  EXTRA — Alertas tropicales            │
│                                        │
│  • Google ya las trae (nov 2025)       │
│  • O agregar AccuWeather para alertas  │
│    si Google no es suficiente          │
└────────────────────────────────────────┘
```

### Por qué este camino

1. **Riesgo cero al inicio**: WeatherAPI gratis sin tarjeta
2. **Aprendizaje barato**: si la feature no se adopta, pierdes solo 2 días de desarrollo
3. **Migración fácil**: la capa `WeatherService` con adapters (ver Arquitectura Técnica) permite cambiar de provider sin rehacer UI
4. **Escalabilidad demostrada**: Google + Firebase es el stack natural cuando crezcas
5. **Hedging de riesgo**: no apuestas todo a una sola API desde el día 1

---

## 🤔 Última reflexión: ¿realmente necesitas la mejor?

Para una app de **control de asistencia en construcción**, lo que el usuario realmente necesita saber es:

| Pregunta del usuario | API mínima necesaria |
|---|---|
| ¿Lloverá hoy? | Cualquiera (todas tienen current weather) |
| ¿Lloverá mañana o pasado? | Cualquiera con 2+ días forecast (todas) |
| ¿Habrá huracán esta semana? | Google o AccuWeather (alertas oficiales) |
| ¿Cuántos grados hace? | Cualquiera |
| ¿Hay neblina/visibilidad mala? | Cualquiera |

**La precisión hiper-local** (que ofrecen Google/Tomorrow.io con sus modelos AI) **no aporta valor real** en una app de asistencia. La diferencia entre 28°C y 28.5°C, o lluvia "85% prob" vs "87% prob", no cambia decisiones operativas.

### Conclusión pragmática

**WeatherAPI.com es probablemente más que suficiente** para tu caso real durante mucho tiempo. Solo migra a Google si:
- Vas a comercializar la app a varias empresas (revenue justifica el setup extra)
- Quieres alertas tropicales oficiales (relevante en temporada jun-nov)
- Llegas a 5,000+ usuarios activos

**No optimices prematuramente**: empieza simple, valida la feature con usuarios reales, y migra solo cuando los números lo justifiquen.

---

## Arquitectura Técnica

### Estructura de datos

```javascript
// En state global
state.weather = {
    enabled: true,                  // settings.weatherEnabled
    location: {                     // settings.weatherLocation
        lat: 18.47, lon: -69.89,
        name: 'Santo Domingo, RD',
        // Soporte multi-sitio (Fase 3):
        sites: [
            { id: 'sd', name: 'Santo Domingo', lat: 18.47, lon: -69.89 },
            { id: 'pc', name: 'Punta Cana', lat: 18.50, lon: -68.40 }
        ]
    },
    cache: {
        lastFetch: '2026-04-18T08:00:00Z',
        location: { lat: 18.47, lon: -69.89 },
        provider: 'google',         // o 'weatherapi'
        current: { temp: 28, condition: 'rain', precip: 85, wind: 15 },
        forecast: [
            { date: '2026-04-18', icon: 'thunderstorm', tempMax: 28, tempMin: 22, precipChance: 85 },
            { date: '2026-04-19', icon: 'sunny', tempMax: 30, tempMin: 24, precipChance: 5 },
            // ...5-10 días
        ],
        alerts: [                   // huracanes, lluvia fuerte, etc.
            { severity: 'warning', title: 'Tormenta tropical Beta', expires: '...' }
        ]
    }
};

// Notas independientes del clima
state.dayNotes = {
    '2026-04-18': {
        text: "Suspendido vaciado por lluvia",
        authorId: 'admin-uid',
        updatedAt: '2026-04-18T14:30:00Z',
        weatherSnapshot: { condition: 'rain', precip: 85 } // opcional: capturar clima en ese momento
    }
};

// 🆕 Histórico de clima por día (~50 bytes/día = 18 KB/año)
// Permite mostrar iconos retrospectivos en el calendario, correlacionar
// asistencia con clima, justificar ausencias masivas, etc.
state.weatherHistory = {
    'sd': {                              // clave del sitio
        '2026-04-15': {
            icon: 'sunny',               // categoría normalizada
            tempMax: 31, tempMin: 22,
            precip: 5,                   // % probabilidad
            captured: 'live'             // 'live' (día vivido) o 'forecast'
        },
        '2026-04-18': {
            icon: 'stormy',
            tempMax: 24, tempMin: 21,
            precip: 90,
            captured: 'live'
        }
        // ...una entrada por cada día con datos
    }
    // 'pc': { ... }                     // multi-sitio: histórico independiente
};
```

### Iconos normalizados

Para independencia del proveedor de API, los iconos se normalizan a un set fijo:

| Categoría interna | Emoji | Equivalente API |
|---|---|---|
| `sunny` | ☀️ | clear, sun, sunny |
| `partly-cloudy` | 🌤️ | partlycloudy, fair |
| `cloudy` | ⛅ | cloudy, overcast |
| `rainy` | 🌧️ | rain, showers, drizzle |
| `stormy` | ⛈️ | thunderstorm, storm |
| `windy` | 💨 | windy |
| `hot` | 🔥 | extreme heat (>35°C) |
| `hurricane` | 🌀 | tropical storm, hurricane |
| `unknown` | ❓ | sin datos / error API |

### Estrategia de caché

**Objetivo:** minimizar llamadas a la API.

| Dato | TTL caché | Storage |
|---|---|---|
| Clima actual | 30 minutos | IndexedDB (sobrevive recarga) |
| Forecast 5-10 días | 6 horas | IndexedDB |
| Alertas | 15 minutos | IndexedDB |
| Histórico (consultas a fechas pasadas) | Indefinido | IndexedDB |

**Ejemplo de impacto:**
- Sin caché: 1000 usuarios × 10 lookups/día = 10,000 calls/día
- Con caché 30min: ~500 calls/día (~15k/mes)
- Con caché agrupada por ubicación: ~50 calls/día por sitio único

### Capa de abstracción

```
┌─────────────────────────────────────────┐
│  UI Components                          │
│  (WeatherChip, WeatherPanel, Sidebar)   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  WeatherService (interfaz unificada)    │
│  - getCurrent(lat, lon)                 │
│  - getForecast(lat, lon, days)          │
│  - getAlerts(lat, lon)                  │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴───────┐
       │               │
┌──────▼──────┐ ┌──────▼─────────┐
│ GoogleAdapter│ │WeatherAPIAdapter│
└──────┬───────┘ └────────┬───────┘
       │                  │
       └────────┬─────────┘
                │
        ┌───────▼────────┐
        │ Cache Layer    │
        │ (IndexedDB)    │
        └────────────────┘
```

Permite **cambiar de proveedor** sin tocar UI.

### Fallback offline

1. **Con caché reciente (<6h)**: mostrar normalmente con indicador `🕐 hace 2h`
2. **Caché vieja (6-24h)**: mostrar con advertencia `⚠️ Datos de hace X horas`
3. **Sin caché o >24h**: mostrar `🌐 Sin pronóstico disponible` (estado discreto)

### Error handling

- API timeout (>5s) → usar caché, mostrar advertencia
- API error 429 (rate limit) → caché + retry con backoff
- API error 401 (key inválida) → log a Firebase, notificar admin, fallback a estado offline
- Geolocalización denegada → usar ubicación configurada en Ajustes

---

## Plan de Implementación por Fases

### Fase 1 — MVP (1-2 días)
- Chip de clima en navpill (Propuesta D)
- API: WeatherAPI.com (free tier, no requiere tarjeta)
- Ubicación: configurable en Ajustes (no geolocalización aún)
- Caché en IndexedDB (30min current, 6h forecast)
- Sin notas todavía
- Solo móvil

### Fase 2 — Notas del día (1 día)
- Nota editable en el panel del chip
- Sincronización con Firebase (`users/{uid}/dayNotes/{dateKey}`)
- Aparece en reportes de nómina como justificación
- Captura snapshot del clima al guardar nota (para histórico)

### Fase 3 — Vista desktop (0.5 día)
- Sidebar lateral en pantallas ≥1024px
- Pronóstico siempre expandido

### Fase 4 — Alertas (1 día)
- Notificación local cuando se pronostica lluvia fuerte para el día siguiente
- Permiso de notificaciones gestionado por PWA
- Configurable: umbrales de alerta en Ajustes

### Fase 5 — Multi-sitio (1-2 días)
- Soporte para varias ubicaciones por organización
- Selector de sitio en el chip
- Útil para empresas con obras en diferentes ciudades

### Fase 6 — Migración a Google Weather API (0.5 día)
- Una vez validada la integración, migrar de WeatherAPI a Google
- Mismo `WeatherService`, distinto adapter
- Mayor confiabilidad y forecast de 10 días

### Fase 7 — Histórico de clima en el calendario (1 día) ⭐ NUEVO

**Idea de origen:** mostrar en el calendario el icono del clima de cada día pasado, para tener contexto visual de por qué hubo ausencias, salidas tempranas, etc.

- Capturar `weatherHistory[siteId][dateKey]` cada vez que se obtiene clima
- Sobrescribir `forecast` → `live` cuando el día efectivamente llega
- Modificar `CalendarView.js` para renderizar el icono en cada celda
- Mostrar `📝` adicional en días con nota guardada
- Click en día pasado → tooltip/modal con detalles (clima + asistencia + nota)

### Fase 8 — Análisis de patrones por empleado (2 días) 🔮

- Detectar correlaciones empleado × clima
- Mostrar en el perfil: "4 de 5 ausencias en días lluviosos"
- Métrica de "confiabilidad climática" por empleado

### Fase 9 — Reportes con contexto climático (1-2 días) 🔮

- Reporte mensual con columna de clima
- Productividad por tipo de día (soleado vs lluvioso)
- Exportación Excel/PDF incluye iconos de clima
- Justificación documentada de pagos por días con clima adverso

### Fase 10 — Inteligencia predictiva (2-3 días) 🔮

- Auto-sugerir notas cuando el clima es extremo
- Alertas predictivas comparando pronóstico con histórico:
  *"Mañana llueve como el viernes pasado, faltaron 8 personas"*
- Sugerencia preventiva de avisos al equipo

---

## 🔮 Visión a largo plazo: Clima como herramienta de gestión

> **Estado:** Concepto / Roadmap aspiracional
> **No es prioritario** — son extensiones naturales una vez implementado el MVP

La combinación de **clima + asistencia + notas** crea un set de datos único que ninguna app de asistencia tradicional tiene. Esto abre oportunidades que van más allá de "mostrar el pronóstico":

### Oportunidad 1: Detección automática de patrones

> *"Carlos faltó 4 de los últimos 6 días lluviosos. Pedro tiene 100% de asistencia incluso con tormentas."*

Métrica visible en el perfil del empleado como un indicador de **confiabilidad climática** — útil para asignar empleados a obras con mayor exposición al exterior.

### Oportunidad 2: Auto-relleno inteligente de notas

Cuando el clima del día es extremo (lluvia >70%, tormenta tropical), sugerir automáticamente una nota base que el usuario puede editar:

```
┌─────────────────────────────────────┐
│ ⛈️ Tormenta detectada hoy           │
│                                     │
│ ¿Aplicar nota sugerida?             │
│ "Día con lluvia fuerte registrada"  │
│                                     │
│ [Aplicar]   [Editar]   [Descartar]  │
└─────────────────────────────────────┘
```

### Oportunidad 3: Reporte de productividad climática

```
📊 Reporte de Abril 2026

Días trabajados: 30
├─ ☀️ Días buenos: 18 → 144h promedio
├─ ⛅ Días nublados: 6 → 138h
├─ 🌧️ Días con lluvia: 4 → 92h (-36%)
└─ ⛈️ Días con tormenta: 2 → 38h (-74%)

Productividad perdida por clima:
~104 horas-hombre estimadas

Tu peor día: Vie 18 (⛈️ Tormenta Beta)
Tu mejor día: Lun 6 (☀️ Soleado)
```

### Oportunidad 4: Alertas predictivas inteligentes

> *"Mañana se pronostica lluvia fuerte como el viernes pasado, cuando faltaron 8 personas. Considera mandar mensaje preventivo a la cuadrilla."*

Combina:
- Pronóstico futuro de la API
- Histórico de asistencia del equipo
- Correlación entre ambos

Resultado: avisos accionables, no solo información.

### Oportunidad 5: Justificación automatizada de pagos

Para empresas que pagan "medio día por lluvia" o tienen reglas similares:

```
Nómina · Juan Pérez · Abril 2026

Días pagados con bonificación climática:
├─ Vie 18 (⛈️ tormenta) — 4h trabajadas, pagadas como 8h
└─ Mar 22 (🌧️ lluvia fuerte) — 6h trabajadas, pagadas como 8h

+ 6h adicionales pagadas por clima adverso documentado
```

Esto es **prueba documental** para auditorías o disputas laborales.

### Oportunidad 6: Mapa de calor mensual

Visualización doble: clima vs asistencia, mismo grid:

```
Clima:        Asistencia:
   L  M  M  J  V    L  M  M  J  V
S1 ☀️ ☀️ 🌤️ 🌤️ ⛅  S1 ✓ ✓ ✓ ✓ ✓
S2 🌧️ ⛈️ ⛈️ 🌤️ ☀️  S2 ✓ ✗ ✗ ✓ ✓
S3 🌤️ ⛅ 🌧️ ⛈️ ⛈️  S3 ✓ ✓ ✗ ✗ ✗

→ Patrón claro: las ausencias siguen al mal clima
```

### Oportunidad 7: Exportación enriquecida

El Excel/PDF mensual que ya generas, pero con una columna nueva:

| Fecha | Clima | Empleado | Horas | Justificación |
|---|---|---|---|---|
| 14/04 | ☀️ | Juan Pérez | 8h | — |
| 15/04 | 🌧️ | Juan Pérez | 4h | Lluvia (auto) |
| 16/04 | ⛈️ | Juan Pérez | 0h | Tormenta — Suspendido |

Diferenciador comercial frente a apps genéricas de asistencia.

---

### 💡 Por qué este conjunto es valioso

1. **Costo de almacenamiento despreciable** — 18 KB/año por sitio
2. **Aprovecha llamadas a la API que ya se hacen** — solo se cachea más agresivamente
3. **Valor compuesto con el tiempo** — cuanto más uso, más útil
4. **Diferencia tu app del mercado** — apps de asistencia genéricas no tienen este contexto
5. **Cada oportunidad es opcional** — se puede implementar gradualmente sin compromiso

### Mockups visuales de iconos en el calendario

#### Vista mensual con clima histórico

```
┌─── Abril 2026 ──────────────────┐
│ D    L    M    M    J    V    S │
│              1☀️  2☀️  3🌤️ 4🌤️ │
│ 5⛅  6🌧️ 7⛈️ 8⛈️ 9🌤️ 10☀️ 11☀️│
│ 12🌤️13⛅ 14🌧️15⛈️16⛈️17⛅18☀️│ ← Hoy = 18
│ 19   20   21   22   23   24  25 │ ← Futuro (vacío o forecast tenue)
│ 26   27   28   29   30          │
└─────────────────────────────────┘
```

#### Con marcas de notas

```
┌─── Abril 2026 ──────────────────┐
│ D    L    M    M    J    V    S │
│              1☀️  2☀️  3🌤️ 4🌤️ │
│ 5⛅  6🌧️ 7⛈️📝8⛈️📝9🌤️10☀️11☀️│ ← 7 y 8 tuvieron notas
│ 12🌤️13⛅ 14🌧️15⛈️📝16⛈️17⛅18☀️│
└─────────────────────────────────┘

Leyenda:
☀️🌤️⛅ Buen tiempo · 🌧️ Lluvia · ⛈️ Tormenta
📝 = Día con nota guardada
```

#### Tap en día pasado → contexto completo

```
┌─────────────────────────────────────┐
│ Lun 7 de Abril, 2026                │
├─────────────────────────────────────┤
│ ⛈️ Tormenta · 23°C                  │
│ 💧 90% precipitación                │
│                                     │
│ 📝 Nota:                            │
│ "Suspendido vaciado. Lluvia desde   │
│  las 9am. Equipo se fue a las 11."  │
│                                     │
│ 👷 Asistencia ese día:              │
│ Presentes: 8 / Ausentes: 10         │
│ Horas totales: 24h (-70% normal)    │
│                                     │
│ [Ver detalles del día]              │
└─────────────────────────────────────┘
```

#### Calendario en el perfil de un empleado

```
Juan Pérez · Abril 2026
┌─── Abril 2026 ──────────────────┐
│ D    L    M    M    J    V    S │
│              1☀️✓ 2☀️✓ 3🌤️✓ 4🌤️│
│ 5⛅ 6🌧️✗ 7⛈️✗ 8⛈️✗ 9🌤️✓10☀️✓11│
│ 12 13⛅✓14🌧️✗15⛈️ 16⛈️✗17⛅✓18  │
└─────────────────────────────────┘

Análisis automático:
• Asistió 18 días, faltó 5
• 4 de las 5 ausencias fueron días lluviosos ⛈️
• Patrón: tiende a faltar con mal tiempo
```

---

## Consideraciones de Privacidad y Seguridad

### API Keys
- **Nunca** hardcodear keys en el código cliente
- Almacenar en Firebase Remote Config o variable de entorno del build
- Restringir key por dominio/origen en consola de Google Cloud
- Rotar key si se filtra accidentalmente

### Geolocalización (opcional)
- **Requiere consentimiento explícito** del usuario (Permission API)
- Por defecto: usar ubicación configurada en Ajustes
- Geolocalización solo como conveniencia, no obligatoria
- Mostrar UI clara: *"Permitir ubicación para clima local"*

### Cuotas y abuso
- Implementar rate limiting en cliente (max 1 call/30s por usuario)
- Monitorear uso desde consola de Google/WeatherAPI
- Alerta si se acerca al 80% del límite mensual

### Datos sensibles
- Las notas del día pueden contener información sensible (incidentes, accidentes)
- **No** loggear contenido de notas en analytics
- Las notas son privadas por usuario (no compartidas entre cuentas Firebase)

---

## Análisis de Costos

### Escenario: 1,000 usuarios activos diarios

**Sin caché (peor caso):**
- 1,000 usuarios × 10 lookups/día × 30 días = **300,000 calls/mes**
- WeatherAPI free (1M/mes): ✅ dentro del límite
- Google free (10k/mes por SKU): ❌ excede

**Con caché 30min + agrupación por ciudad:**
- ~5-10 ubicaciones únicas × 48 lookups/día = **~10,000-20,000 calls/mes**
- WeatherAPI free: ✅ sobra
- Google free: ✅ dentro del límite (10k por endpoint)

**Costo a 10,000 usuarios:**
- Con caché: ~100k-200k calls/mes
- WeatherAPI plan Pro: $4/mes (3M calls)
- Google Weather API pago: ~$5 por 1k calls extra después del free tier

### Conclusión: **el costo es despreciable** con caché bien implementado, incluso a 10k usuarios.

---

## Preguntas Abiertas Resueltas

> **1.** ¿Cuál de las 4 propuestas (o combinación) es más adecuada?

✅ **Resuelto:** Propuesta **D (Chip) + B (Panel)** — chip mínimo en navpill que despliega panel con detalles. En desktop, sidebar lateral.

> **2.** ¿Las notas del día deben sincronizarse con Firebase?

✅ **Resuelto:** **Sí**. Razones:
- Mismo dispositivo no es garantía: usuarios pueden cambiar de teléfono
- Multi-dispositivo: jefe ve la nota desde oficina, capataz desde obra
- Aparecen en reportes de nómina como justificación
- Sincronización mediante el mismo BatchedSaver ya implementado

> **3.** ¿Geolocalización automática o configuración manual?

✅ **Resuelto:** **Manual primero, geolocalización opcional**:
- Por defecto: ubicación configurada en Ajustes (típicamente la dirección de la oficina/obra)
- Opcional: botón "Usar mi ubicación actual" que dispara Permission API
- Multi-sitio (Fase 5): permite tener varias ubicaciones guardadas

> **4.** ¿Proyecto separado o integrado al plan de períodos de pago?

✅ **Resuelto:** **Proyecto separado**. Son features independientes con timelines distintos.

> **5.** ¿Qué API usar?

✅ **Resuelto:** Estrategia por fase:
- **MVP**: WeatherAPI.com (free, sin tarjeta)
- **Producción**: Google Weather API (integración Firebase)
- **Alertas críticas**: agregar AccuWeather para tormentas tropicales si la región lo justifica

> **6.** ¿Qué pasa si se rompe la API?

✅ **Resuelto:** Capa `WeatherService` con adapters intercambiables. Permite cambiar de proveedor sin tocar UI. Caché de hasta 24h en IndexedDB amortigua interrupciones.

---

## 🚧 Próximos Pasos para Implementación

Cuando se decida implementar:

1. **Validar requerimientos** con el cliente final (Fase 1 features mínimas)
2. **Crear cuenta WeatherAPI.com** (o habilitar Google Weather en GCP)
3. **Diseñar el `WeatherService`** y los adapters
4. **Implementar chip + panel** (Fase 1)
5. **Iterar** según feedback antes de Fase 2

### Dependencias técnicas

- ✅ Sistema de iconos consistente (`IconSystem.js` ya existe)
- ✅ Sistema de Modal/Panel (`Modal.js` ya existe)
- ✅ Sincronización Firebase (`FirebaseService.js` ya existe)
- ✅ Caché en IndexedDB (`IndexedDBService.js` ya existe)
- ✅ Sistema de notificaciones (`Notification.js` ya existe) — para Fase 4

**Buena noticia:** toda la infraestructura necesaria ya existe en la app. La implementación es principalmente UI nueva + un nuevo servicio (WeatherService).

---

## 📚 Referencias

- [Google Weather API — Documentación oficial](https://developers.google.com/maps/documentation/weather/overview)
- [WeatherAPI.com — Pricing](https://www.weatherapi.com/pricing.aspx)
- [OpenWeatherMap — Pricing](https://openweathermap.org/price)
- [Open-Meteo — Terms (revisar licencia comercial)](https://open-meteo.com/en/terms)
- [MDN — Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- [PWA Notifications](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
