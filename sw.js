/**
 * Service Worker — Control de Asistencia v1.6.7
 * Estrategia: App Shell + Stale While Revalidate
 *
 * CACHE_VERSION: Se bumpa automáticamente en cada commit (pre-commit hook).
 * Formato: YYYY.MMDD.HHmm — NO editar manualmente.
 */

const CACHE_VERSION = '2026.0621.030200';
const CACHE_NAME = `asistencia-v${CACHE_VERSION}`;

// ─────────────────────────────────────────────
// Assets que conforman el "shell" de la app.
// Se cachean en el evento install (precache).
// ─────────────────────────────────────────────
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icon-144.png',
    './icon-192.png',
    './icon-512.png',

    // CSS
    './css/styles.css',
    './css/header.css',
    './css/navigation.css',
    './css/attendance_ui.css',
    './css/employee_profile.css',
    './css/onboarding.css',
    './css/maintenance.css',

    // JS principal
    './js/app.js',

    // Core
    './js/modules/core/AppState.js',
    './js/modules/core/Connectivity.js',
    './js/modules/core/Events.js',
    './js/modules/core/ModalManager.js',
    './js/modules/core/PWA.js',
    './js/modules/core/Performance.js',
    './js/modules/core/RenderManager.js',
    './js/modules/core/Workers.js',

    // Config
    './js/modules/config/Config.js',

    // Components
    './js/modules/components/App.js',
    './js/modules/components/BadgeComponent.js',
    './js/modules/components/CalendarPickerComponent.js',
    './js/modules/components/ComponentBase.js',
    './js/modules/components/FormComponent.js',
    './js/modules/components/Modal.js',
    './js/modules/components/Notification.js',
    './js/modules/components/SearchComponent.js',
    './js/modules/components/StatCardComponent.js',
    './js/modules/components/SystemAlertsManager.js',
    './js/modules/components/TabComponent.js',
    './js/modules/components/TableComponent.js',
    './js/modules/components/TooltipComponent.js',
    './js/modules/components/VirtualScroll.js',

    // Services
    './js/modules/services/DataService.js',
    './js/modules/services/ExportService.js',
    './js/modules/services/FirebaseService.js',
    './js/modules/services/IndexedDBService.js',
    './js/modules/services/InstallPromptManager.js',
    './js/modules/services/OfflineManager.js',
    './js/modules/services/PersistenceService.js',
    './js/modules/services/ScrollService.js',
    './js/modules/services/StorageService.js',
    './js/modules/services/ValidationService.js',
    './js/modules/services/index.js',

    // Utils
    './js/modules/utils/Constants.js',
    './js/modules/utils/DOMDiff.js',
    './js/modules/utils/DateManagers.js',
    './js/modules/utils/DateUtils.js',
    './js/modules/utils/Debug.js',
    './js/modules/utils/Formatters.js',
    './js/modules/utils/Helpers.js',
    './js/modules/utils/LazyLoader.js',
    './js/modules/utils/LegacyMigrator.js',
    './js/modules/utils/MemoCache.js',
    './js/modules/utils/Performance.js',
    './js/modules/utils/RenderManager.js',
    './js/modules/utils/UndoManager.js',
    './js/modules/utils/WebWorkerPool.js',

    // UI
    './js/modules/ui/AttendanceHandlers.js',
    './js/modules/ui/AttendanceUI.js',
    './js/modules/ui/Header.js',
    './js/modules/ui/IconSystem.js',
    './js/modules/ui/MaintenanceUI.js',
    './js/modules/ui/ModalManager.js',
    './js/modules/ui/Onboarding.js',
    './js/modules/ui/QuickViewComponents.js',
    './js/modules/ui/RestoreUI.js',
    './js/modules/ui/SettingsUI.js',
    './js/modules/ui/SyncUI.js',
    './js/modules/ui/VirtualScroll.js',
    './js/modules/ui/components/CalendarView.js',
    './js/modules/ui/components/EmployeeFloatingCard.js',
    './js/modules/ui/modals/AdvancedAttendanceModal.js',
    './js/modules/ui/modals/EmployeeModal.js',
    './js/modules/ui/modals/EmployeeProfileModal.js',
    './js/modules/ui/modals/LeaderModal.js',
    './js/modules/ui/modals/PositionModal.js',
    './js/modules/ui/settings/SettingsTestsTab.js',

    // Features
    './js/modules/features/analytics/AnalyticsUI.js',
    './js/modules/features/analytics/ChartService.js',
    './js/modules/features/attendance/Attendance.js',
    './js/modules/features/attendance/AttendanceService.js',
    './js/modules/features/attendance/HolidayService.js',
    './js/modules/features/employees/Employee.js',
    './js/modules/features/employees/EmployeesUI.js',
    './js/modules/features/employees/Leader.js',
    './js/modules/features/employees/Position.js',
    './js/modules/features/payroll/PayrollService.js',
    './js/modules/features/payroll/PayrollUI.js',
    './js/modules/features/stats/EmployeeStatsService.js',

    // Data
    './js/modules/data/DemoSeed.js',
    './js/modules/data/firebase.js',

    // Screenshots (manifest)
    './screenshots/screenshot_1_attendance.png',
    './screenshots/screenshot_2_personal.png',
    './screenshots/screenshot_3_reportes.png',
    './screenshots/screenshot_4_nomina.png',
    './screenshots/screenshot_5_weekly.png'
];

// CDNs externos (se cachean en runtime, no en precache)
const CDN_HOSTS = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com'
];

// Dominios de Firebase (nunca cachear — son API calls dinámicas)
const FIREBASE_HOSTS = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'apis.google.com',
    'www.googleapis.com',
    'firebase.googleapis.com',
    'firebaseinstallations.googleapis.com'
];

// ─────────────────────────────────────────────
// INSTALL: Precachear el app shell
// ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log(`[SW] Instalando v${CACHE_VERSION}`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // Usar addAll con manejo de errores por archivo individual
                // para que un 404 en un archivo no rompa todo el precache
                return Promise.allSettled(
                    APP_SHELL.map((url) =>
                        cache.add(url).catch((err) => {
                            console.warn(`[SW] No se pudo cachear: ${url}`, err.message);
                        })
                    )
                );
            })
            .then(() => {
                console.log(`[SW] App shell cacheado`);
                // Activar inmediatamente sin esperar que se cierren tabs anteriores
                return self.skipWaiting();
            })
    );
});

// ─────────────────────────────────────────────
// ACTIVATE: Limpiar caches viejos
// ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activando v${CACHE_VERSION}`);
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('asistencia-') && name !== CACHE_NAME)
                        .map((name) => {
                            console.log(`[SW] Eliminando cache viejo: ${name}`);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                // Tomar control de todas las páginas abiertas inmediatamente
                return self.clients.claim();
            })
    );
});

// ─────────────────────────────────────────────
// FETCH: Estrategia por tipo de recurso
// ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1) Ignorar requests que no sean GET
    if (event.request.method !== 'GET') return;

    // 2) Nunca interceptar llamadas a Firebase (son datos dinámicos)
    if (FIREBASE_HOSTS.some((host) => url.hostname.includes(host))) return;

    // 3) Nunca interceptar chrome-extension, blob, etc.
    if (!url.protocol.startsWith('http')) return;

    // 4) CDN externos → Cache First (rara vez cambian)
    if (CDN_HOSTS.some((host) => url.hostname.includes(host))) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // 5) Navegación (HTML) → Network First con fallback a cache
    //    Esto asegura que siempre se obtenga la versión más reciente
    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // 6) Assets propios (JS, CSS, imágenes) → Stale While Revalidate
    //    Sirve rápido desde cache, pero actualiza en background
    event.respondWith(staleWhileRevalidate(event.request));
});

// ─────────────────────────────────────────────
// ESTRATEGIAS DE CACHE
// ─────────────────────────────────────────────

/**
 * Cache First: Sirve desde cache. Si no está, va a red y cachea.
 * Ideal para CDNs y assets que rara vez cambian.
 */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        // Sin red y sin cache → respuesta genérica de error
        return new Response('Recurso no disponible offline', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

/**
 * Network First: Intenta red primero. Si falla, sirve desde cache.
 * Ideal para navegación HTML (siempre obtener la más reciente).
 */
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;

        // Fallback: devolver index.html cacheado (SPA)
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;

        return new Response('App no disponible offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html' }
        });
    }
}

/**
 * Stale While Revalidate: Sirve desde cache inmediatamente,
 * y en background actualiza el cache con la versión de red.
 * Ideal para JS/CSS propios — velocidad + frescura.
 */
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    // Lanzar fetch en background para actualizar
    const fetchPromise = fetch(request)
        .then((response) => {
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => new Response('Recurso no disponible offline', {
            status: 503,
            statusText: 'Service Unavailable'
        }));

    // Si hay cache, devolver inmediatamente. Si no, esperar la red.
    return cached || fetchPromise;
}

// ─────────────────────────────────────────────
// MENSAJES: Comunicación con la app
// ─────────────────────────────────────────────
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data === 'GET_VERSION') {
        event.ports[0].postMessage({ version: CACHE_VERSION });
    }

    if (event.data === 'CLEAR_CACHE') {
        caches.keys().then((names) => {
            names.forEach((name) => caches.delete(name));
        });
    }
});