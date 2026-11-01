import { p2pActivityStore, P2P_ACTIVITY_KINDS, P2P_ACTIVITY_STATUSES } from './P2PActivityStore.js';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * One activity per integration. A proposal built from pasted text or attendance is replaced
 * when its rows change, so it is keyed by its origin and keeps a single activity.
 */
export function intakeActivityId(entry) {
    const key = entry.local ? JSON.stringify([entry.peerId, entry.payload.saProjectId, 'local']) : entry.id;
    return `personal-${hash(key)}`;
}

function describe(entry) {
    const total = entry.payload.employees.length;
    const done = entry.mappings?.length || 0;
    if (entry.status === 'discarded') {
        return { status: P2P_ACTIVITY_STATUSES.ERROR, summary: `Propuesta descartada: ${plural(total, 'empleado', 'empleados')}` };
    }
    if (!done) return { status: P2P_ACTIVITY_STATUSES.PENDING, summary: `Personal por revisar: ${plural(total, 'empleado', 'empleados')}` };
    return {
        status: done === total ? P2P_ACTIVITY_STATUSES.SUCCESS : P2P_ACTIVITY_STATUSES.PARTIAL,
        summary: `${done} de ${plural(total, 'empleado integrado', 'empleados integrados')}`
    };
}

/** Records (or refreshes) the single activity of this proposal. Never throws: it is only a log. */
export function recordIntakeActivity(entry, { activityStore = p2pActivityStore, projectName = '' } = {}) {
    try {
        activityStore.recordActivity({
            id: intakeActivityId(entry), kind: P2P_ACTIVITY_KINDS.ROSTER, ...describe(entry),
            peerName: entry.peerName || 'Mini', projectName, peerId: entry.peerId, saProjectId: entry.payload.saProjectId
        });
    } catch (error) {
        console.warn('No se pudo registrar la actividad de personal:', error);
    }
}
