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
    VERSION: "6.6 (Sync Optimized)",
    DATABASE_NAME: "asistencia-db",
    STORAGE_KEY: "asistencia-data",
    MAX_RECORDS_MEMORY: 2000,
    RELEVANT_DAYS_LIMIT: 60
};

/**
 * 🆔 Genera o recupera un ID único para este dispositivo/navegador/origen.
 * El ID incluye el origen de la URL (host:port) para garantizar que dos instancias
 * de la app en dominios distintos (ej: localhost:5500 vs GitHub Pages) nunca
 * compartan el mismo ID, lo que causaría que el echo filter bloqueara la sincronización
 * en una de las dos direcciones.
 */
export const getDeviceId = () => {
    // La clave incluye el origen para que cada "entorno" tenga su propio ID
    const origin = window.location.host; // ej: "127.0.0.1:5500" o "usuario.github.io"
    const storageKey = `asistencia_device_id_${origin}`;

    let deviceId = localStorage.getItem(storageKey);
    if (!deviceId) {
        // Incluir el origen en el ID para trazabilidad en logs de Firebase
        const originSlug = origin.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
        deviceId = `${originSlug}_${Math.random().toString(36).substr(2, 9)}_${Date.now().toString(36)}`;
        localStorage.setItem(storageKey, deviceId);
    }
    return deviceId;
};
