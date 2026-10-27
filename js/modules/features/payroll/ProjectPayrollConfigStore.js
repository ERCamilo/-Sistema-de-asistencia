/**
 * F1.6-A2 — ProjectPayrollConfigStore
 * Local-only IndexedDB repository for projectPayrollConfigs (keyPath projectId).
 * Never publishes to cloud (A2 local-only). Atomic seed via single IDB transaction.
 */

import { indexedDBService } from '../../services/IndexedDBService.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { resolveDailyTargetHours } from '../../utils/AttendanceHours.js';

// Serialize commits from this tab for each obra. Other project settings
// cannot clobber a day-hours edit while a prior save is pending.
const pendingConfigWrites = new Map();
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
    const projectId = payload.projectId;
    // Transient metadata from updateActiveDayHours. The store applies a
    // per-day patch to the latest durable state rather than replacing the
    // whole record captured before another save completed.
    const dayHoursPatch = payload.__dayHoursPatch;
    const dayHoursDelta = payload.__dayHoursDelta;
    const holidaysPatch = payload.__holidaysPatch;
    delete payload.__dayHoursPatch;
    delete payload.__dayHoursDelta;
    delete payload.__holidaysPatch;
    const previous = pendingConfigWrites.get(projectId) || Promise.resolve();
    const commit = previous.catch(() => {}).then(async () => {
        const latest = await idb.get(STORE_NAME, projectId);
        // A day-hours-only save must also preserve unrelated fields edited
        // since the caller captured its earlier configuration snapshot.
        const next = dayHoursPatch && latest
            ? { ...payload, ...latest, projectId }
            : { ...(latest || {}), ...payload };
        // A full settings write based on an older snapshot must not undo
        // day-hours committed after that snapshot was read. Callers editing
        // day-hours explicitly supply __dayHoursPatch.
        const staleSnapshot = latest && (Number(payload.updatedAt) || 0) < (Number(latest.updatedAt) || 0);
        if (staleSnapshot && !dayHoursPatch && latest.dayHours !== undefined) {
            next.dayHours = latest.dayHours;
        }
        // Apply an explicit field patch to the current durable record.
        // Avoid overwriting unrelated fields from an out-of-date form.
        if (holidaysPatch !== undefined) next.holidays = holidaysPatch;
        if (dayHoursPatch && typeof dayHoursPatch === 'object') {
            next.dayHours = { ...(latest?.dayHours || {}), ...dayHoursPatch };
            for (const [date, delta] of Object.entries(dayHoursDelta || {})) {
                const base = resolveDailyTargetHours(date, latest?.dayHours, latest?.regularHoursPerDay || payload.regularHoursPerDay);
                next.dayHours[date] = Math.max(0, Math.min(24, base + Number(delta)));
            }
        }
        next.schemaVersion = SCHEMA_VERSION;
        delete next.seeded;
        next.updatedAt = Math.max(Date.now(), (Number(latest?.updatedAt) || 0) + 1);
        await idb.update(STORE_NAME, next);
        return clone(next);
    });
    pendingConfigWrites.set(projectId, commit);
    try {
        return await commit;
    } finally {
        if (pendingConfigWrites.get(projectId) === commit) pendingConfigWrites.delete(projectId);
    }
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
    // seeded: valores iniciales; una configuración real de otro dispositivo la reemplaza.
    const config = { ...createDefaultConfig(canonicalId, legacySettings || {}), seeded: true };
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
