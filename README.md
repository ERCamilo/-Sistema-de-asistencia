# Control de Asistencia

Aplicación web progresiva (PWA) para el control de asistencia, nómina y caja chica,
pensada para equipos de construcción y con funcionalidad **offline-first**.

Está construida en **JavaScript de navegador (sin framework)** con **Firebase** como
backend y se despliega como sitio estático en **Cloudflare Pages**.

---

## Características

- **Asistencia** diaria y vista semanal, con cálculo de horas y horas extra.
- **Nómina** por período de pago configurable.
- **Reportes** y analítica de horas, presentismo y tendencias.
- **Préstamos y adelantos** con libro mayor por empleado.
- **Caja chica** con OCR de comprobantes (vía webhook n8n).
- **Offline-first**: la app funciona sin conexión y sincroniza al volver online.
- **Multi-dispositivo**: sincronización en tiempo real entre pestañas/dispositivos
  del mismo usuario, con resolución de conflictos (filtro de eco + id por pestaña).
- **PWA instalable** (manifest, service worker, íconos, accesos directos).

---

## Stack

| Capa | Tecnología |
|------|-----------|
| UI / lógica | JavaScript (ES Modules), sin framework |
| Estado | Sistema reactivo propio basado en `Proxy` (`js/modules/core/AppState.js`) |
| Backend | Firebase (Firestore, Storage, Auth con Google) — SDK 10.8.0 vía CDN |
| Persistencia local | IndexedDB + Service Worker (`sw.js`) |
| Integraciones | n8n (OCR de caja chica), WeatherAPI (clima) |
| Tests | Jest + jsdom, con un *runner* propio (`testRunner`) |
| Despliegue | Cloudflare Pages (cabeceras en `_headers`) |

> El SDK de Firebase se carga **en runtime desde el CDN de gstatic** (versión 10.8.0)
> en [`js/modules/data/firebase.js`](js/modules/data/firebase.js). Esa es la única
> fuente de verdad de la versión: el proyecto **no** declara `firebase` como
> dependencia de npm.

---

## Estructura del proyecto

```
.
├── index.html                  # Punto de entrada (SPA + PWA)
├── sw.js                       # Service Worker (cache versionado, offline)
├── manifest.json               # Manifiesto PWA
├── _headers                    # Cabeceras de seguridad (Cloudflare Pages)
├── firestore.rules             # Reglas de seguridad de Firestore
├── storage.rules               # Reglas de seguridad de Storage
├── firebase.json               # Apunta a las reglas anteriores
├── privacy.html                # Política de privacidad
├── delete-account.html         # Borrado de cuenta (requisito Play Store)
└── js/
    ├── modules/
    │   ├── core/               # Estado, eventos, render, PWA, conectividad
    │   ├── config/             # Config.js (claves públicas y constantes)
    │   ├── data/               # Inicialización de Firebase y seed de demo
    │   ├── services/           # Persistencia, Firebase, IndexedDB, sync
    │   ├── features/           # Dominios: payroll, loans, pettycash, analytics…
    │   ├── ui/                 # Vistas y componentes de pantalla
    │   ├── components/         # Componentes reutilizables
    │   └── utils/              # Utilidades (fechas, CDN lazy, etc.)
    └── tests/                  # Suite Jest (*.test.js) + helpers
```

---

## Puesta en marcha

### Requisitos

- **Node.js 20+** (solo para correr los tests; la app es estática).
- Un navegador moderno.

### Ejecutar la app localmente

La aplicación es un sitio **estático**: no hay paso de *build*. Servila con cualquier
servidor estático y abrila en el navegador. Por ejemplo:

```bash
npx serve .
# o la extensión "Live Server" de VS Code (puerto 5500 por defecto)
```

> El inicio de sesión con Google y la sincronización con Firebase requieren que el
> origen esté autorizado en la consola de Firebase. En local, `127.0.0.1:5500`
> suele estar permitido para desarrollo.

### Instalar dependencias de desarrollo

```bash
npm ci
```

Esto también instala los *git hooks* del proyecto (`core.hooksPath -> .githooks`).

---

## Tests

```bash
npm test              # corre toda la suite Jest una vez
npm run test:watch    # modo watch
npm run test:coverage # con reporte de cobertura
```

La suite usa `jsdom` y **mockea Firebase / IndexedDB** (`__mocks__/`, vía
`moduleNameMapper` en `jest.config.js`), así que no toca la red ni necesita
credenciales.

> **Nota (Windows):** correr la suite completa en paralelo puede disparar errores
> `bash: fork: Resource temporarily unavailable` por límites de procesos de
> cygwin — son del *runner*, no fallos de test. Si te pasa, usá
> `npx jest --runInBand` o `--maxWorkers=50%`. En el CI (Ubuntu) no ocurre.

---

## Despliegue

Se publica como sitio estático en **Cloudflare Pages**. El archivo
[`_headers`](_headers) adjunta cabeceras de seguridad a cada respuesta
(`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` y una `Content-Security-Policy`). Está cubierto por
`js/tests/HeadersFileTests.js` para que no pueda desaparecer ni desviarse en
silencio.

> La CSP se publica primero en modo **`Report-Only`**: reporta violaciones a la
> consola sin bloquear nada. Tras verificar en producción que no hay reportes
> legítimos, se promueve a `Content-Security-Policy` (modo enforcing).

---

## Seguridad

- **Reglas de Firestore y Storage** con principio de menor privilegio: cada usuario
  solo lee/escribe lo suyo (`request.auth.uid == userId`) y todo lo demás se deniega
  por defecto. Ver [`firestore.rules`](firestore.rules) y
  [`storage.rules`](storage.rules).
- **Cabeceras de seguridad** versionadas y testeadas en [`_headers`](_headers).
- La `apiKey` de Firebase es un identificador **público** (no un secreto): la
  seguridad la imponen las reglas. Se recomienda restringirla por *referrer HTTP*
  en Google Cloud Console.

---

## Configuración

Las constantes y claves públicas viven en
[`js/modules/config/Config.js`](js/modules/config/Config.js): configuración de
Firebase, versión de la app (`APP_CONFIG.VERSION`), nombre de la base IndexedDB y
URLs de los webhooks de caja chica.

---

## Licencia

Software propietario — Todos los derechos reservados. © 2026 Erlin Camilo.
Ver [`LICENSE`](LICENSE).
