const FOLDERS = new Set(['active', 'archive', 'trash']);

/** Older backups have text but no card state. Reading them is enough to list them. */
export function readNoteCard(record) {
    const card = record?.noteCard;
    return {
        folder: FOLDERS.has(card?.folder) ? card.folder : 'active',
        pinned: card?.pinned === true,
        updatedAt: Number.isFinite(card?.updatedAt) ? card.updatedAt : 0
    };
}

export function updateNoteCard(record, change, now = Date.now()) {
    const current = readNoteCard(record);
    const folder = change.folder ?? current.folder;
    const pinned = change.pinned ?? current.pinned;
    if (!FOLDERS.has(folder) || typeof pinned !== 'boolean') throw Error('Estado de nota inválido.');
    return { ...record, noteCard: { folder, pinned, updatedAt: Math.max(now, current.updatedAt + 1) } };
}

export function visibleNoteText(record) {
    return readNoteCard(record).folder !== 'trash' && typeof record?.notes === 'string'
        ? record.notes : '';
}
