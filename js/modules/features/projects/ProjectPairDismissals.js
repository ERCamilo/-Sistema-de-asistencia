import { indexedDBService } from '../../services/IndexedDBService.js';
import { mutateProjectCatalog } from './ProjectNameConflicts.js';
import { isDismissedPair } from './ProjectSimilarity.js';

/**
 * «No son la misma»: el usuario descarta que dos obras sean duplicadas. El
 * descarte vive en el documento de la obra de id menor (`notSameAs`), viaja con
 * el catálogo (ProjectCatalogSync lo une entre dispositivos) y silencia el par
 * en ProjectSimilarity. Nunca modifica ni borra datos de las obras.
 */

const trimId = value => String(value ?? '').trim();

export async function dismissProjectPair(idA, idB, { idb = indexedDBService } = {}) {
    const a = trimId(idA);
    const b = trimId(idB);
    if (!a || !b || a === b) throw new Error('Elige dos obras distintas.');
    const [owner, other] = a < b ? [a, b] : [b, a];
    const saved = await mutateProjectCatalog(idb, rows => {
        const ownerRow = rows.find(row => row.id === owner && row.deletedAt == null);
        const otherRow = rows.find(row => row.id === other && row.deletedAt == null);
        if (!ownerRow || !otherRow) throw new Error('La obra ya no está disponible. Actualiza la lista.');
        if (isDismissedPair(ownerRow, otherRow)) return { writes: [], result: null };
        const known = Array.isArray(ownerRow.notSameAs) ? ownerRow.notSameAs.filter(id => typeof id === 'string') : [];
        const row = {
            ...ownerRow,
            notSameAs: [...new Set([...known.map(trimId), other])].sort(),
            updatedAt: Math.max(Date.now(), (Number(ownerRow.updatedAt) || 0) + 1)
        };
        return { writes: [row], result: row };
    });
    if (saved) announceDismissal(owner, other);
    return saved;
}

function announceDismissal(owner, other) {
    try {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId: owner, dismissedPair: [owner, other] } }));
        }
    } catch (_) { /* sin UI */ }
}

export default { dismissProjectPair };
