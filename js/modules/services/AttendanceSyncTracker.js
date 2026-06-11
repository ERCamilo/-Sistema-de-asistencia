/**
 * 📡 AttendanceSyncTracker.js — patrón "WhatsApp" para la asistencia
 *
 * Marcar asistencia es una acción EN RÁFAGA (20 empleados seguidos). Un toast
 * por marca es ruido; uno tardío es peor. Este módulo da feedback por ÍTEM:
 *
 *   1. Al marcar: el check responde al instante (lo local ya se guardó) y un
 *      ANILLO girando alrededor (.cloud-pending) indica "subiendo a la nube".
 *   2. Cuando el espejo confirma: anillos fuera (.cloud-synced, brillo breve)
 *      y UN solo toast agregado: "N asistencias guardadas en la nube".
 *   3. Si la nube falla o no responde: anillos en ámbar (.cloud-failed) y
 *      toast amarillo "N asistencias solo en este equipo".
 *
 * La clase de estado vive en el .check-container — updateCheckboxOnly solo
 * resetea .check-box, así que el anillo sobrevive al render ultra-selectivo.
 *
 * `createAttendanceSyncTracker` es la máquina pura (deps inyectadas, sin DOM).
 * El singleton de abajo la cablea al DOM real y a Notification. La señal de
 * nube llega por eventBus ('sync:mirror-result', emitido por el espejo de
 * PersistenceService); app.js hace esa conexión.
 */

import { Notification as NotificationSystem } from '../components/Notification.js';

/**
 * @param {{
 *   applyMark: (empId:string, state:'pending'|'synced'|'failed') => void,
 *   notify: (level:'success'|'warning', message:string) => void
 * }} deps
 */
export function createAttendanceSyncTracker({ applyMark, notify }) {
    const pending = new Set(); // empIds con cambios esperando la nube

    const countMsg = (n, tail) =>
        n === 1 ? `1 asistencia ${tail.singular}` : `${n} asistencias ${tail.plural}`;

    return {
        /** Registra un cambio de asistencia (marcar O desmarcar) rumbo a la nube. */
        markPending(empId) {
            if (!empId) return;
            pending.add(empId);
            applyMark(empId, 'pending');
        },

        /** El espejo confirmó: todo lo pendiente ya está en la nube. */
        cloudConfirmed() {
            if (pending.size === 0) return; // sync de fondo sin cambios nuestros
            const n = pending.size;
            pending.forEach(empId => applyMark(empId, 'synced'));
            pending.clear();
            notify('success', countMsg(n, {
                singular: 'guardada en la nube',
                plural: 'guardadas en la nube'
            }));
        },

        /** El espejo falló (o no respondió): lo pendiente quedó solo local. */
        cloudFailed() {
            if (pending.size === 0) return;
            const n = pending.size;
            pending.forEach(empId => applyMark(empId, 'failed'));
            pending.clear();
            notify('warning', countMsg(n, {
                singular: 'solo en este equipo (aún no en la nube)',
                plural: 'solo en este equipo (aún no en la nube)'
            }));
        },

        pendingCount() { return pending.size; }
    };
}

// ─── Singleton cableado al DOM real ──────────────────────────────────────────

const CLOUD_CLASSES = ['cloud-pending', 'cloud-synced', 'cloud-failed'];

function _applyMarkDOM(empId, state) {
    try {
        const container = document.querySelector(`#emp-row-${empId} .check-container`);
        if (!container) return; // vista distinta o fila fuera de pantalla: no-op
        container.classList.remove(...CLOUD_CLASSES);
        container.classList.add(`cloud-${state}`);
        if (state === 'synced') {
            // El brillo de confirmación es transitorio: se limpia solo.
            setTimeout(() => {
                try { container.classList.remove('cloud-synced'); } catch (_) { /* noop */ }
            }, 2000);
        }
    } catch (_) { /* DOM no disponible: no-op */ }
}

function _notifyToast(level, message) {
    try {
        const fn = NotificationSystem[level] || NotificationSystem.info;
        fn(message, level === 'warning' ? 8000 : undefined);
    } catch (e) { console.warn('⚠️ AttendanceSyncTracker toast:', e); }
}

export const attendanceSyncTracker = createAttendanceSyncTracker({
    applyMark: _applyMarkDOM,
    notify: _notifyToast
});

export default attendanceSyncTracker;
