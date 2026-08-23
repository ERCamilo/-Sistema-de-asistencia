/**
 * Configuración centralizada de la aplicación
 * Aquí se almacenan las llaves de servicios externos y constantes de configuración.
 */

export const firebaseConfig = {
    apiKey: "AIzaSyDF8sJaHAMx4mRqMWo_J6Cpd6_ZjIc4jYA",
    authDomain: "phoenix-asistencia-ab641.firebaseapp.com",
    projectId: "phoenix-asistencia-ab641",
    storageBucket: "phoenix-asistencia-ab641.firebasestorage.app",
    messagingSenderId: "538815178313",
    appId: "1:538815178313:web:f6403d517dc805a94e0198",
    measurementId: "G-16NDJX46YN"
};

export const APP_CONFIG = {
    VERSION: "1.7.0",
    LAST_UPDATED: "2026-07-11",
    DATABASE_NAME: "attendance-app-db", // L2: coincide con el nombre real de la BD IndexedDB
    STORAGE_KEY: "asistencia-data",
    MAX_RECORDS_MEMORY: 2000,
    RELEVANT_DAYS_LIMIT: 60,
    // 🤖 Caja chica — OCR de facturas (webhook configurable; hoy n8n,
    // migrable a Firebase Function sin tocar la app).
    OCR_WEBHOOK_URL: "https://n8n.erlin.do/webhook/caja-chica-ocr",
    // 📤 Caja chica — subir foto del comprobante a Supabase (vía n8n).
    RECEIPT_UPLOAD_URL: "https://n8n.erlin.do/webhook/caja-chica-subir",
    // 🖼️ Imágenes privadas genéricas — la app envía coordenadas lógicas, nunca rutas.
    APP_IMAGES_URL: "https://n8n.erlin.do/webhook/app-images",
    // 🪞 Espejo privado de movimientos. Firebase conserva la fuente de verdad.
    PETTY_CASH_MIRROR_URL: "https://odokvayemjbrjgkhbtqj.supabase.co/functions/v1/petty-cash-movement"
};

// Cache en memoria del id de ESTA pestaña (contexto de página). Garantiza un
// id estable aunque sessionStorage no esté disponible (modo privado, iframes
// sandbox), y evita releer en cada llamada.
let _tabDeviceId = null;

/**
 * 🔐 Token aleatorio con resistencia a colisión. Prefiere crypto.randomUUID()
 * (disponible en todos los navegadores modernos y en Node 19+); cae a una
 * combinación de Math.random()+timestamp sólo si la API no existe.
 */
const randomToken = () => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch (_) { /* sin crypto: fallback abajo */ }
    return `${Math.random().toString(36).substr(2, 9)}_${Date.now().toString(36)}`;
};

/**
 * 🆔 Genera o recupera un ID único para ESTA PESTAÑA del navegador.
 *
 * ⚠️ H3 (auditoría 2026-06-09): antes el id se guardaba en localStorage por
 * origen, así que TODAS las pestañas compartían el mismo id. El filtro de eco
 * descarta cualquier snapshot cuyo `lastChangedBy`/`deviceId` coincida con el
 * propio → la pestaña B ignoraba los cambios de la pestaña A creyéndolos su
 * propio eco, y luego su estado viejo pisaba el cambio (lost update).
 *
 * Ahora el id es POR PESTAÑA: se respalda en sessionStorage, que NO se comparte
 * entre pestañas pero SÍ sobrevive un F5 dentro de la misma pestaña. Así dos
 * pestañas tienen ids distintos y cada una procesa el cambio de la otra como
 * remoto. Se conserva el slug del origen para trazabilidad en logs de Firebase.
 *
 * (Optimización futura — opp. #4: un BroadcastChannel propagaría los cambios
 * entre pestañas sin el round-trip a Firestore, cubriendo también el caso
 * offline. El id por pestaña ya cierra el lost-update vía el listener normal.)
 */
export const getDeviceId = () => {
    if (_tabDeviceId) return _tabDeviceId;

    const origin = window.location.host; // ej: "127.0.0.1:5500" o "usuario.github.io"
    const originSlug = origin.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    const storageKey = `asistencia_device_id_${origin}`;

    let deviceId = null;
    try {
        deviceId = sessionStorage.getItem(storageKey);
    } catch (_) { /* sessionStorage bloqueado: usamos sólo el cache en memoria */ }

    if (!deviceId) {
        deviceId = `${originSlug}_${randomToken()}`;
        try {
            sessionStorage.setItem(storageKey, deviceId);
        } catch (_) { /* no persistible: el cache en memoria mantiene estabilidad en la pestaña */ }
    }

    _tabDeviceId = deviceId;
    return deviceId;
};
