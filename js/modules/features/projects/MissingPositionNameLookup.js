/**
 * Busca en los respaldos (snapshots) el nombre original de puestos que ya no
 * existen. Recorre del más reciente al más viejo y se detiene en cuanto los
 * encuentra todos. Las funciones de lectura se inyectan (FirebaseService en
 * la app, dobles en los tests). Solo lee.
 */
export async function findPositionNamesInSnapshots(positionIds = [], {
    listSnapshots, getSnapshot, limit = 25
} = {}) {
    const pending = new Set((positionIds || []).map(value => String(value ?? '').trim()).filter(Boolean));
    const names = {};
    const result = { names, scanned: 0, failed: 0 };
    if (!pending.size || typeof listSnapshots !== 'function' || typeof getSnapshot !== 'function') return result;
    const snapshots = await listSnapshots(limit);
    for (const item of snapshots || []) {
        if (!pending.size) break;
        let snapshot = null;
        try {
            snapshot = await getSnapshot(item.id);
        } catch (_) {
            result.failed++;
            continue;
        }
        result.scanned++;
        for (const position of snapshot?.state?.positions || []) {
            const positionId = String(position?.id ?? '').trim();
            if (!pending.has(positionId) || !String(position?.name ?? '').trim()) continue;
            names[positionId] = {
                name: String(position.name).trim(),
                projectId: position.projectId || null,
                snapshotId: item.id,
                snapshotAt: item.timestamp || item.createdAt || null
            };
            pending.delete(positionId);
        }
    }
    return result;
}

export default { findPositionNamesInSnapshots };
