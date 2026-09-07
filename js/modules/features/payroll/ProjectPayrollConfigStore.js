/**
 * F1.6-A2 — ProjectPayrollConfigStore
 * Local-only IndexedDB repository for projectPayrollConfigs (keyPath projectId).
 * Never publishes to cloud (A2 local-only). Atomic seed via single IDB transaction.
 */

import { indexedDBService } from '../../services/IndexedDBService.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import {
    PROJECT_PAYROLL_CONFIG_STORE,
    PROJECT_PAYROLL_CONFIG_SCHEMA_VERSION,
    createDefaultConfig
} from './ProjectPayrollConfig.js';

export const STORE_NAME = PROJECT_PAYROLL_CONFIG_STORE;
export const SCHEMA_VERSION = PROJECT_PAYROLL_CONFIG_SCHEMA_VERSION;

function isValidProjectId(id) {
    if (!id || typeof id !== 'string') return false;
    const t = id.trim();
    return !!t && !t.startsWith('legacy-unresolved:');
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

export async function getConfig(projectId, opts = {}) {
    if (!isValidProjectId(String(projectId || ''))) return null;
    const idb = opts.idb || indexedDBService;
    try {
        const raw = await idb.get(STORE_NAME, String(projectId));
        return raw ? clone(raw) : null;
    } catch (_) {
        return null;
    }
}

export async function putConfig(config, opts = {}) {
    if (!config || !isValidProjectId(String(config.projectId || ''))) {
        throw new TypeError('putConfig requires valid projectId');
    }
    const idb = opts.idb || indexedDBService;
    const payload = clone(config);
    payload.projectId = String(payload.projectId);
    payload.schemaVersion = SCHEMA_VERSION;
    payload.updatedAt = Date.now();
    await idb.update(STORE_NAME, payload);
    return clone(payload);
}

export async function listAll(opts = {}) {
    const idb = opts.idb || indexedDBService;
    try {
        const all = await idb.getAll(STORE_NAME);
        return (all || []).map(clone);
    } catch (_) {
        return [];
    }
}

/**
 * Atomic idempotent seed for the default project.
 * - Flag OFF → skipped (no write, preserves legacy settings exclusively)
 * - Invalid canonicalId → skipped
 * - Already exists → never overwrites (read-then-conditional-write in same transaction)
 * Uses indexedDBService.atomicMutate for single-transaction check-then-put.
 */
export async function ensureDefaultSeed(defaultProjectId, legacySettings = {}, opts = {}) {
    const idb = opts.idb || indexedDBService;
    if (!isProjectsEnabled()) return { skipped: true, reason: 'flag-off' };
    if (!isValidProjectId(String(defaultProjectId || ''))) return { skipped: true, reason: 'invalid-id' };
    const canonicalId = String(defaultProjectId);
    let existed = false;
    let resultPayload = null;
    const config = createDefaultConfig(canonicalId, legacySettings || {});
    try {
        if (typeof idb.atomicMutate === 'function') {
            resultPayload = await idb.atomicMutate(STORE_NAME, canonicalId, (existing) => {
                if (existing) {
                    existed = true;
                    return { write: false, value: existing };
                }
                return { write: true, value: config };
            });
            if (existed) return { skipped: true, reason: 'already-exists', config: clone(resultPayload) };
            return { seeded: true, config: clone(resultPayload || config) };
        }
        // Fallback if atomicMutate unavailable (should not happen in real IDB)
        const existing = await idb.get(STORE_NAME, canonicalId);
        if (existing) return { skipped: true, reason: 'already-exists', config: clone(existing) };
        await idb.update(STORE_NAME, config);
        return { seeded: true, config: clone(config) };
    } catch (error) {
        // Never throw to caller (boot never-throw contract); surface as skipped
        return { skipped: true, reason: 'error', error };
    }
}

export async function deleteConfig(projectId, opts = {}) {
    if (!isValidProjectId(String(projectId || ''))) return false;
    const idb = opts.idb || indexedDBService;
    try {
        await idb.delete(STORE_NAME, String(projectId));
        return true;
    } catch (_) {
        return false;
    }
}

export default {
    STORE_NAME,
    SCHEMA_VERSION,
    getConfig,
    putConfig,
    listAll,
    ensureDefaultSeed,
    deleteConfig
};
