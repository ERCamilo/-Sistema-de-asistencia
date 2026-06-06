/**
 * 📸 SnapshotNotifier.js
 * Muestra un toast discreto cuando se crea un snapshot automático/del sistema,
 * para que el usuario sepa que la app lo está protegiendo (Snapshot UX H).
 *
 * Los snapshots manuales NO disparan toast aquí: el código del botón ya
 * muestra su propio "✅ Snapshot guardado".
 *
 * Diseño: aislado de FirebaseService para que sea fácil de testear (sin
 * tener que pelearse con moduleNameMapper) y para que el caller no tenga
 * que conocer la API del componente Notification.
 */

import { Notification } from '../components/Notification.js';
import { getReasonInfo, SNAPSHOT_REASONS } from './SnapshotReasons.js';

/**
 * Decide si esta razón/tipo merece notificar al usuario.
 * Reglas:
 *   - 'manual'        → no (lo muestra el caller del botón)
 *   - 'daily-auto'    → sí (el usuario suele no esperarlo)
 *   - 'pre-*'         → sí (el usuario está a punto de hacer una operación riesgosa)
 *   - cualquier 'auto'/'pre-restore' aunque sin reason en catálogo → sí (genérico)
 */
function shouldNotify(reason, type) {
    if (reason === 'manual') return false;
    if (reason && SNAPSHOT_REASONS[reason]) return true;
    // Fallback: type auto o pre-restore notifica con label genérico
    return type === 'auto' || type === 'pre-restore';
}

/**
 * Construye el texto del toast a partir del catálogo de razones.
 * Devuelve '' si no hay información útil para mostrar.
 */
function buildMessage(reason, type) {
    const info = getReasonInfo(reason, type);
    if (!info || !info.label) return '';
    const prefix = '📸 Punto de restauración creado';
    return `${prefix} · ${info.icon || ''} ${info.label}`.trim();
}

/**
 * 📣 Notifica al usuario que se creó un snapshot del sistema.
 * Defensivo: nunca lanza. Si algo va mal, falla silenciosa.
 *
 * @param {{reason?: string, reasonLabel?: string, type?: string, isProtected?: boolean}} meta
 *   Metadata del snapshot recién creado (forma: lo que retorna FirebaseService).
 */
export function notifySnapshotCreated(meta) {
    try {
        if (!meta) return;
        const { reason, type } = meta;

        if (!shouldNotify(reason, type)) return;

        const message = buildMessage(reason, type);
        if (!message) return;

        // Toast discreto, no sticky.
        Notification.info(message, { duration: 4000 });
    } catch (e) {
        // Nunca romper la creación del snapshot por un error en la notificación.
        console.warn('⚠️ notifySnapshotCreated: error al notificar (ignorado):', e);
    }
}
