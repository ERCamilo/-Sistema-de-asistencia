import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { DEFAULT_PROJECT_LS_KEY } from '../projects/EntityProjectScope.js';
import { promoteLegacyPayrollClosure, PAYROLL_CLOSURE_IDENTITY_KIND } from './PayrollClosure.js';
import indexedDBService from '../../services/IndexedDBService.js';

export const STAMPER_STATE_KEY = 'payrollClosureStamperState';
export const STAMPER_STORE = 'settings';

function readDefaultProjectId() {
    try {
        return localStorage.getItem(DEFAULT_PROJECT_LS_KEY);
    } catch (_) {
        return null;
    }
}

function resolveOwnerDefault() {
    const v = readDefaultProjectId();
    if (v && String(v).trim() && !String(v).trim().startsWith('legacy-unresolved:')) return String(v).trim();
    return v ? String(v).trim() : null;
}

function isDeferredOwner(canonical) {
    return !canonical || String(canonical).startsWith('legacy-unresolved:');
}

function normalizeDeferredIds(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    for (const id of list) {
        if (id == null) continue;
        const s = String(id);
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

async function loadState(db) {
    try {
        const s = await db.get(STAMPER_STORE, STAMPER_STATE_KEY);
        return s || null;
    } catch (_) {
        return null;
    }
}

async function saveState(db, state) {
    await db.update(STAMPER_STORE, { ...state, key: STAMPER_STATE_KEY });
}

async function fetchChunk(db, afterId, limit) {
    await db.init();
    return new Promise((resolve, reject) => {
        const tx = db.db.transaction(['payrollClosures'], 'readonly');
        const store = tx.objectStore('payrollClosures');
        const range = afterId ? IDBKeyRange.lowerBound(afterId, true) : null;
        const req = store.openCursor(range, 'next');
        const out = [];
        req.onsuccess = e => {
            const cursor = e.target.result;
            if (!cursor || out.length >= limit) {
                resolve(out);
                return;
            }
            out.push(cursor.value);
            if (out.length >= limit) {
                resolve(out);
                return;
            }
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });
}

export class PayrollClosureStamper {
    constructor({ db = indexedDBService, resolveOwner = null } = {}) {
        this.db = db;
        this.resolveOwner = resolveOwner || (() => resolveOwnerDefault());
    }

    async getState() {
        return loadState(this.db);
    }

    async resetState() {
        try {
            await this.db.delete(STAMPER_STORE, STAMPER_STATE_KEY);
        } catch (_) {}
    }

    async run({ chunkSize = 20, onChunk = null } = {}) {
        if (!isProjectsEnabled()) {
            return { processed: 0, promoted: 0, skipped: 0, deferred: 0, errors: 0, completed: false, aborted: 'off' };
        }
        const limit = Math.max(1, Math.min(100, Math.trunc(Number(chunkSize) || 20)));
        const prev = await loadState(this.db);
        let lastId = prev?.lastId || null;
        let processed = Number(prev?.processed) || 0;
        let promoted = Number(prev?.promoted) || 0;
        let skipped = Number(prev?.skipped) || 0;
        let errors = Number(prev?.errorCount) || 0;
        let deferredIds = normalizeDeferredIds(prev?.deferredIds);
        let deferredSet = new Set(deferredIds);
        let deferred = deferredIds.length;
        // Keep legacy field prev.deferred if exists but prefer ids length
        if (Number.isFinite(Number(prev?.deferred)) && prev.deferredIds == null) {
            deferred = Number(prev.deferred) || 0;
        }
        const hasDeferred = deferredIds.length > 0;
        if (prev?.completed && !hasDeferred) {
            // B2.4: completed must not hide new legacy inserted while OFF.
            // Fast-path return only if no legacy schema2 remains; otherwise reset cursor
            // so records with id < lastId are detected. Idempotent checks keep already
            // promoted records untouched, preserving cursor resumability.
            let hasPendingLegacy = false;
            try {
                const all = await this.db.getAll('payrollClosures').catch(() => []);
                hasPendingLegacy = (all || []).some(r => Number(r?.schemaVersion) === 2 && !r?.projectId && !r?.identityKind);
            } catch (_) {}
            if (!hasPendingLegacy) {
                return { processed, promoted, skipped, deferred, errors, completed: true, lastId, deferredIds: [...deferredIds] };
            }
            lastId = null;
        }

        // Drain deferred queue from previous pass before cursor scan
        if (deferredIds.length > 0) {
            const nextDeferredIds = [];
            let drainPromoted = 0;
            let drainSkipped = 0;
            for (const deferredId of [...deferredIds]) {
                try {
                    const rec = await this.db.get('payrollClosures', deferredId);
                    if (!rec) continue;
                    if (rec?.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
                        drainSkipped++;
                        continue;
                    }
                    if (Number(rec?.schemaVersion) !== 2) {
                        drainSkipped++;
                        continue;
                    }
                    if (rec?.projectId || rec?.identityKind) {
                        drainSkipped++;
                        continue;
                    }
                    const owner = this.resolveOwner(rec);
                    const canonical = owner ? String(owner).trim() : null;
                    if (isDeferredOwner(canonical)) {
                        nextDeferredIds.push(String(deferredId));
                        continue;
                    }
                    const next = promoteLegacyPayrollClosure(rec, canonical);
                    await this.db.atomicMutate('payrollClosures', next.id, existing => {
                        if (!existing) return { write: true, value: next };
                        if (existing.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
                            return { write: false, value: existing };
                        }
                        if (Number(existing.schemaVersion) !== 2) {
                            return { write: false, value: existing };
                        }
                        const promotedExisting = promoteLegacyPayrollClosure(existing, canonical);
                        return { write: true, value: promotedExisting };
                    });
                    drainPromoted++;
                    promoted++;
                } catch (_) {
                    errors++;
                }
            }
            // Update state after drain
            skipped += drainSkipped;
            deferredIds = normalizeDeferredIds(nextDeferredIds);
            deferredSet = new Set(deferredIds);
            deferred = deferredIds.length;
            // Persist progress after drain so interrupt+resume keeps it
            // Only save if we made progress or deferred set changed
            if (drainPromoted > 0 || drainSkipped > 0 || nextDeferredIds.length !== (prev?.deferredIds?.length || 0)) {
                const drainState = {
                    lastId,
                    processed,
                    promoted,
                    skipped,
                    deferred,
                    deferredIds: [...deferredIds],
                    errorCount: errors,
                    completed: false,
                    updatedAt: Date.now()
                };
                await saveState(this.db, drainState);
            }
            // If drain cleared all deferred and cursor was already at end, we may complete without scanning
            // Fall through to cursor scan to handle new records inserted after lastId
        }

        while (true) {
            const chunk = await fetchChunk(this.db, lastId, limit);
            if (chunk.length === 0) {
                const completed = deferredIds.length === 0;
                const finalState = {
                    lastId,
                    processed,
                    promoted,
                    skipped,
                    deferred,
                    deferredIds: [...deferredIds],
                    errorCount: errors,
                    completed,
                    updatedAt: Date.now()
                };
                await saveState(this.db, finalState);
                return { processed, promoted, skipped, deferred, errors, completed, lastId, deferredIds: [...deferredIds] };
            }

            for (const record of chunk) {
                try {
                    if (record?.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
                        skipped++;
                        // If this id was previously deferred but now is promoted-legacy, remove from deferred queue
                        if (deferredSet.has(String(record.id))) {
                            deferredSet.delete(String(record.id));
                            deferredIds = deferredIds.filter(id => id !== String(record.id));
                            deferred = deferredIds.length;
                        }
                        continue;
                    }
                    if (Number(record?.schemaVersion) !== 2) {
                        skipped++;
                        if (deferredSet.has(String(record.id))) {
                            deferredSet.delete(String(record.id));
                            deferredIds = deferredIds.filter(id => id !== String(record.id));
                            deferred = deferredIds.length;
                        }
                        continue;
                    }
                    if (record?.projectId || record?.identityKind) {
                        skipped++;
                        if (deferredSet.has(String(record.id))) {
                            deferredSet.delete(String(record.id));
                            deferredIds = deferredIds.filter(id => id !== String(record.id));
                            deferred = deferredIds.length;
                        }
                        continue;
                    }
                    const owner = this.resolveOwner(record);
                    const canonical = owner ? String(owner).trim() : null;
                    if (isDeferredOwner(canonical)) {
                        if (!deferredSet.has(String(record.id))) {
                            deferredSet.add(String(record.id));
                            deferredIds.push(String(record.id));
                            deferred = deferredIds.length;
                        }
                        continue;
                    }
                    // If this record was previously deferred and now promotable, remove from deferred queue upon success
                    const next = promoteLegacyPayrollClosure(record, canonical);
                    await this.db.atomicMutate('payrollClosures', next.id, existing => {
                        if (!existing) return { write: true, value: next };
                        if (existing.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
                            return { write: false, value: existing };
                        }
                        if (Number(existing.schemaVersion) !== 2) {
                            return { write: false, value: existing };
                        }
                        const promotedExisting = promoteLegacyPayrollClosure(existing, canonical);
                        return { write: true, value: promotedExisting };
                    });
                    promoted++;
                    if (deferredSet.has(String(record.id))) {
                        deferredSet.delete(String(record.id));
                        deferredIds = deferredIds.filter(id => id !== String(record.id));
                        deferred = deferredIds.length;
                    }
                } catch (_) {
                    errors++;
                }
            }

            lastId = String(chunk[chunk.length - 1].id);
            processed += chunk.length;

            const state = {
                lastId,
                processed,
                promoted,
                skipped,
                deferred,
                deferredIds: [...deferredIds],
                errorCount: errors,
                completed: false,
                updatedAt: Date.now()
            };
            await saveState(this.db, state);
            if (onChunk) {
                const shouldContinue = await onChunk({ chunk, lastId, processed, promoted, skipped, deferred, deferredIds: [...deferredIds], errors });
                if (shouldContinue === false) {
                    return { processed, promoted, skipped, deferred, errors, completed: false, lastId, deferredIds: [...deferredIds], interrupted: true };
                }
            }

            if (chunk.length < limit) {
                const completed = deferredIds.length === 0;
                const finalState = {
                    lastId,
                    processed,
                    promoted,
                    skipped,
                    deferred,
                    deferredIds: [...deferredIds],
                    errorCount: errors,
                    completed,
                    updatedAt: Date.now()
                };
                await saveState(this.db, finalState);
                return { processed, promoted, skipped, deferred, errors, completed, lastId, deferredIds: [...deferredIds] };
            }
        }
    }
}

export const payrollClosureStamper = new PayrollClosureStamper();
export default payrollClosureStamper;
