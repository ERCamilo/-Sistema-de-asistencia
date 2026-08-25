/**
 * 🚩 FeatureFlags.js (F0.6)
 *
 * Flags de funcionalidad por dispositivo, respaldados en localStorage: una
 * clave por flag bajo el namespace `asistencia_feature_`, con valor string
 * 'true'/'false'. Lectura fail-safe: default OFF y cualquier valor distinto
 * de 'true' exacto se interpreta como OFF.
 *
 * Decisión de manifiesto: la clave NO se registra en
 * LocalWipeService.LOCAL_TRACE_KEYS — al igual que `app:debugMode`
 * (utils/Debug.js), un flag de rollout es un ajuste del dispositivo y no un
 * dato del usuario, así que sobrevive "Borrar Local" a propósito.
 */

const STORAGE_KEY = 'asistencia_feature_projects';

export const isProjectsEnabled = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (_) {
        return false; // localStorage bloqueado (modo privado): OFF seguro
    }
};

export const setProjectsEnabled = (enabled) => {
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (_) { /* sin persistencia: el flag vive sólo en esta página */ }
};

export default { isProjectsEnabled, setProjectsEnabled };
