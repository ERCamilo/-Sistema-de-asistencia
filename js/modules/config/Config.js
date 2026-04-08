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
 * 🆔 Genera o recupera un ID único para este dispositivo/navegador.
 * Vital para evitar eco de red en sincronización.
 */
export const getDeviceId = () => {
    let deviceId = localStorage.getItem('asistencia_device_id');
    if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
        localStorage.setItem('asistencia_device_id', deviceId);
    }
    return deviceId;
};
