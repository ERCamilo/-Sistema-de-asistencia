import { employeeNumberIdentityKey } from '../employees/EmployeeNumberIdentity.js';

/**
 * Empleados pendientes de asignación que probablemente son la misma persona
 * que un empleado que ya está en una obra válida (p. ej. una copia vieja que
 * quedó de una restauración o de una resolución de duplicados anterior).
 *
 * Solo sugiere: la fusión siempre la confirma el usuario, porque unir a dos
 * personas distintas es difícil de deshacer.
 *   - exact: mismo nombre, sin importar acentos, mayúsculas, espacios u orden
 *     de las palabras.
 *   - probable: mismo número de ficha y mismo primer nombre.
 */
export function normalizePersonName(name) {
    return String(name ?? '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9ñ]+/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function nameTokens(name) {
    return normalizePersonName(name).split(' ').filter(token => token.length > 1);
}

export function countAttendanceByEmployee(attendance = {}) {
    const counts = new Map();
    for (const record of Object.values(attendance || {})) {
        if (!record || record.deletedAt != null) continue;
        const id = String(record.employeeId ?? '');
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
}

export function findDuplicateCandidates(pending, others = [], { attendanceCounts = new Map() } = {}) {
    const pendingId = String(pending?.id ?? '');
    const exactName = normalizePersonName(pending?.name);
    const sortedTokens = nameTokens(pending?.name).sort().join(' ');
    const firstToken = nameTokens(pending?.name)[0] || '';
    const numberKey = employeeNumberIdentityKey(pending?.number);
    if (!pendingId || (!exactName && !numberKey)) return [];
    const out = [];
    for (const other of others) {
        const id = String(other?.id ?? '');
        if (!id || id === pendingId || other?.deletedAt != null) continue;
        let strength = null;
        let reason = '';
        if (exactName && normalizePersonName(other.name) === exactName) {
            strength = 'exact'; reason = 'Mismo nombre';
        } else if (sortedTokens && nameTokens(other.name).sort().join(' ') === sortedTokens) {
            strength = 'exact'; reason = 'Mismo nombre (otro orden)';
        } else if (numberKey && firstToken && employeeNumberIdentityKey(other.number) === numberKey
            && nameTokens(other.name)[0] === firstToken) {
            strength = 'probable'; reason = 'Mismo número y primer nombre';
        }
        if (!strength) continue;
        out.push({
            id, number: other.number ?? '', name: other.name ?? '', projectId: other.projectId ?? null,
            strength, reason, attendanceCount: attendanceCounts.get(id) || 0,
            updatedAt: Number(other.updatedAt) || 0
        });
    }
    return out.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'exact' ? -1 : 1)
        || b.attendanceCount - a.attendanceCount || b.updatedAt - a.updatedAt);
}
