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
            return { processed: 0, promoted: 0, skipped: 0, errors: 0, completed: false, aborted: 'off' };
        }
        const limit = Math.max(1, Math.min(100, Math.trunc(Number(chunkSize) || 20)));
        const prev = await loadState(this.db);
        let lastId = prev?.lastId || null;
        let processed = Number(prev?.processed) || 0;
        let promoted = Number(prev?.promoted) || 0;
        let skipped = Number(prev?.skipped) || 0;
        let errors = Number(prev?.errorCount) || 0;
        if (prev?.completed) {
            return { processed, promoted, skipped, errors, completed: true, lastId };
        }

        while (true) {
            const chunk = await fetchChunk(this.db, lastId, limit);
            if (chunk.length === 0) {
                const finalState = {
                    lastId,
                    processed,
                    promoted,
                    skipped,
                    errorCount: errors,
                    completed: true,
                    updatedAt: Date.now()
                };
                await saveState(this.db, finalState);
                return { processed, promoted, skipped, errors, completed: true, lastId };
            }

            for (const record of chunk) {
                try {
                    if (record?.identityKind === PAYROLL_CLOSURE_IDENTITY_KIND.PROMOTED_LEGACY) {
                        skipped++;
                        continue;
                    }
                    if (Number(record?.schemaVersion) !== 2) {
                        skipped++;
                        continue;
                    }
                    if (record?.projectId || record?.identityKind) {
                        skipped++;
                        continue;
                    }
                    const owner = this.resolveOwner(record);
                    const canonical = owner ? String(owner).trim() : null;
                    if (!canonical || canonical.startsWith('legacy-unresolved:')) {
                        skipped++;
                        continue;
                    }
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
                errorCount: errors,
                completed: false,
                updatedAt: Date.now()
            };
            await saveState(this.db, state);
            if (onChunk) {
                const shouldContinue = await onChunk({ chunk, lastId, processed, promoted, skipped, errors });
                if (shouldContinue === false) {
                    return { processed, promoted, skipped, errors, completed: false, lastId, interrupted: true };
                }
            }

            if (chunk.length < limit) {
                const finalState = {
                    lastId,
                    processed,
                    promoted,
                    skipped,
                    errorCount: errors,
                    completed: true,
                    updatedAt: Date.now()
                };
                await saveState(this.db, finalState);
                return { processed, promoted, skipped, errors, completed: true, lastId };
            }
        }
    }
}

export const payrollClosureStamper = new PayrollClosureStamper();
export default payrollClosureStamper;
