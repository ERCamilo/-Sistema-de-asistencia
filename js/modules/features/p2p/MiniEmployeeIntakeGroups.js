const TEXT_GROUP_KEY = 'text';
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Pasted text and attendance without a connected Mini share one group; each Mini has its own. */
export function intakeGroupKey(entry) {
    const peerId = String(entry?.peerId || '');
    return peerId.startsWith('attendance:') ? TEXT_GROUP_KEY : peerId;
}

function pendingCount(entry) {
    const done = new Set((entry.mappings || []).map(mapping => mapping.miniLocalId));
    return entry.payload.employees.filter(row => !done.has(row.miniLocalId)).length;
}

/** Pending proposals grouped by origin: Minis by name, pasted text last. */
export function groupIntakeEntries(entries, { projectId = '' } = {}) {
    const groups = new Map();
    for (const entry of entries || []) {
        if (entry.status !== 'pending') continue;
        const key = intakeGroupKey(entry);
        if (!groups.has(key)) groups.set(key, { key, kind: key === TEXT_GROUP_KEY ? 'text' : 'mini', label: '', entries: [], totalEmployees: 0, pendingEmployees: 0 });
        const group = groups.get(key);
        group.entries.push(entry);
        group.totalEmployees += entry.payload.employees.length;
        group.pendingEmployees += pendingCount(entry);
    }
    const result = [...groups.values()];
    for (const group of result) {
        group.entries.sort((a, b) => Number(b.receivedAt || 0) - Number(a.receivedAt || 0));
        group.label = group.kind === 'text' ? 'Texto pegado' : (group.entries[0].peerName || 'Mini');
        group.otherProject = group.entries.every(entry => entry.payload.saProjectId !== projectId);
    }
    const rank = group => group.kind === 'text' ? 1 : 0;
    return result.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'es'));
}

/** Text of the single pending notification that opens the groups. */
export function summarizeIntakeGroups(groups) {
    const employees = groups.reduce((sum, group) => sum + group.pendingEmployees, 0);
    if (!groups.length) return { employees: 0, origins: 0, text: '' };
    return {
        employees, origins: groups.length,
        text: `Personal por revisar: ${plural(employees, 'empleado', 'empleados')} de ${plural(groups.length, 'origen', 'orígenes')}`
    };
}
