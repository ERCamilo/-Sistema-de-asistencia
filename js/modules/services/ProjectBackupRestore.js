/**
 * 🔄 ProjectBackupRestore.js (F1.9 S2 / SA-F1.9-PROJECT-RESTORE-068)
 *
 * Dedicated canonical service for project-aware backup restore planning,
 * validation, execution, and atomicity rollback.
 *
 * Requirements:
 * 1. Legacy / Projects-OFF: No project store, config, or pointer writes.
 * 2. Projects ON + valid project-aware backup:
 *    - Full project snapshot restore (authoritative replacement for `projects`
 *      and `projectPayrollConfigs` stores).
 *    - Exact IDs preserved (no ID remapping, no auto-adopt, no cross-project fusion).
 *    - Pointers restored from manifest if identifying restored active projects;
 *      otherwise deterministically falling back to the first restored active project,
 *      and never leaving a dangling pointer.
 * 3. Atomicity & Rollback:
 *    - Snapshots pre-mutation state (core in-memory state, IDB projects, IDB configs,
 *      and localStorage default/active pointers).
 *    - If ANY step fails, rolls back all stores, pointers, and memory state,
 *      preventing any mixed partial state.
 */

import { indexedDBService } from './IndexedDBService.js';
import { isProjectsEnabled } from '../config/FeatureFlags.js';
import { isValidBackupProjectId, getBackupContainer } from './ProjectBackupManifest.js';
import { replaceEntityScope, peekEntityScope, DEFAULT_PROJECT_LS_KEY } from '../features/projects/EntityProjectScope.js';
import { ACTIVE_PROJECT_LS_KEY } from '../features/projects/ProjectContext.js';
import { PROJECT_STATUS } from '../features/projects/Project.js';
import { invalidateAllStats, buildAttendanceIndex } from '../core/AppState.js';

export { DEFAULT_PROJECT_LS_KEY, ACTIVE_PROJECT_LS_KEY };

function clone(value) {
    return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Checks if the backup payload contains applicable project restore data.
 */
export function isProjectBackupApplicable(backupData) {
    if (!isProjectsEnabled()) return false;
    if (!backupData || typeof backupData !== 'object') return false;
    const container = getBackupContainer(backupData);
    return Array.isArray(container.projects);
}

/**
 * Resolves active and default project pointers from restored projects and manifest.
 * Pointers are restored from manifest only if they identify a restored active project;
 * otherwise deterministically falls back to the earliest active project (by createdAt, then id),
 * ensuring a dangling pointer is never left.
 */
export function resolveRestoredPointers(projects, manifestPointers = {}) {
    const list = Array.isArray(projects) ? projects : [];
    const activeProjects = list.filter(p => p && (p.status === PROJECT_STATUS.ACTIVE || p.status === 'active'));

    // Deterministic sorting: createdAt asc, then id asc
    activeProjects.sort((a, b) => (Number(a.createdAt || 0) - Number(b.createdAt || 0)) || String(a.id || '').localeCompare(String(b.id || '')));

    const fallbackActive = activeProjects.length > 0 ? activeProjects[0] : null;

    let defaultProjectId = null;
    const rawDefault = manifestPointers?.defaultProjectId;
    if (rawDefault && activeProjects.some(p => p.id === rawDefault)) {
        defaultProjectId = String(rawDefault).trim();
    } else if (fallbackActive) {
        defaultProjectId = fallbackActive.id;
    }

    let activeProjectId = null;
    const rawActive = manifestPointers?.activeProjectId;
    if (rawActive && activeProjects.some(p => p.id === rawActive)) {
        activeProjectId = String(rawActive).trim();
    } else if (defaultProjectId && activeProjects.some(p => p.id === defaultProjectId)) {
        activeProjectId = defaultProjectId;
    } else if (fallbackActive) {
        activeProjectId = fallbackActive.id;
    }

    return { defaultProjectId, activeProjectId };
}

/**
 * Validates and creates an authoritative restore plan from backup data.
 * Returns null if Projects is OFF or if the backup is legacy/lacks projects.
 * Throws if the project payload is structurally invalid or contains orphan/duplicate configs.
 */
export function planProjectRestore(backupData) {
    if (!isProjectsEnabled()) return null;
    if (!backupData || typeof backupData !== 'object') return null;

    const container = getBackupContainer(backupData);
    if (!Array.isArray(container.projects)) return null;

    const rawProjects = container.projects;
    const rawConfigs = Array.isArray(container.projectPayrollConfigs) ? container.projectPayrollConfigs : [];
    const manifest = container.projectBackup && typeof container.projectBackup === 'object' ? container.projectBackup : null;

    // Validate projects
    const validatedProjects = [];
    const seenIds = new Set();
    for (let i = 0; i < rawProjects.length; i++) {
        const p = rawProjects[i];
        if (!p || typeof p !== 'object') {
            throw new Error(`Invalid project at index ${i}: expected an object`);
        }
        if (!isValidBackupProjectId(p.id)) {
            throw new Error(`Invalid project id at index ${i}: "${p.id}"`);
        }
        const id = String(p.id).trim();
        if (seenIds.has(id)) {
            throw new Error(`Duplicate project id in backup: "${id}"`);
        }
        seenIds.add(id);

        const status = p.status || PROJECT_STATUS.ACTIVE;
        if (status !== PROJECT_STATUS.ACTIVE && status !== PROJECT_STATUS.CLOSED && status !== PROJECT_STATUS.ARCHIVED) {
            throw new Error(`Invalid project status for "${id}": "${status}"`);
        }

        const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Proyecto ${id}`;

        validatedProjects.push({
            ...clone(p),
            id,
            name,
            status
        });
    }

    // Validate configs (fail-closed on orphan or duplicate configs)
    const validatedConfigs = [];
    const seenConfigIds = new Set();
    for (let i = 0; i < rawConfigs.length; i++) {
        const c = rawConfigs[i];
        if (!c || typeof c !== 'object') {
            throw new Error(`Invalid projectPayrollConfig at index ${i}: expected an object`);
        }
        if (!isValidBackupProjectId(c.projectId)) {
            throw new Error(`Invalid projectPayrollConfig projectId at index ${i}: "${c.projectId}"`);
        }
        const pid = String(c.projectId).trim();
        if (!seenIds.has(pid)) {
            throw new Error(`Orphan projectPayrollConfig at index ${i}: project "${pid}" not in restored projects`);
        }
        if (seenConfigIds.has(pid)) {
            throw new Error(`Duplicate projectPayrollConfig for projectId "${pid}" at index ${i}`);
        }
        seenConfigIds.add(pid);

        validatedConfigs.push({
            ...clone(c),
            projectId: pid
        });
    }

    const pointers = resolveRestoredPointers(validatedProjects, manifest);

    return {
        projects: validatedProjects,
        projectPayrollConfigs: validatedConfigs,
        defaultProjectId: pointers.defaultProjectId,
        activeProjectId: pointers.activeProjectId
    };
}

/**
 * Snapshots all mutable state before any restore writes begin.
 * MUST fail closed if projects or configs read fails when Projects ON.
 * Pointer reads distinguish missing key (null) from storage read failures (throws).
 */
export async function captureRestoreRollbackSnapshot(coreState, {
    idb = indexedDBService,
    storage = typeof localStorage !== 'undefined' ? localStorage : null
} = {}) {
    const coreSnapshot = {
        settings: clone(coreState?.settings || {}),
        positions: clone(coreState?.positions || []),
        employees: clone(coreState?.employees || []),
        leaders: clone(coreState?.leaders || []),
        attendance: clone(coreState?.attendance || {}),
        tempAssignments: clone(coreState?.tempAssignments || []),
        dayHoursConfig: clone(coreState?.dayHoursConfig || {})
    };

    const projectsEnabled = isProjectsEnabled();
    let currentProjects = [];
    let currentConfigs = [];
    let defaultProjectId = null;
    let activeProjectId = null;
    let scope = null;

    if (projectsEnabled) {
        currentProjects = (await idb.getAll('projects')) || [];
        currentConfigs = (await idb.getAll('projectPayrollConfigs')) || [];
        if (storage) {
            defaultProjectId = storage.getItem(DEFAULT_PROJECT_LS_KEY);
            activeProjectId = storage.getItem(ACTIVE_PROJECT_LS_KEY);
        }
        scope = peekEntityScope();
    }

    return {
        coreState: coreSnapshot,
        projectsEnabled,
        projects: (currentProjects || []).map(clone),
        projectPayrollConfigs: (currentConfigs || []).map(clone),
        defaultProjectId,
        activeProjectId,
        entityScope: scope
    };
}

/**
 * Applies the validated project restore plan (authoritative replacement of projects & configs).
 * Does not swallow pointer write errors. Keeps EntityScope coherent only after pointer writes succeed.
 */
export async function applyProjectRestore(plan, {
    idb = indexedDBService,
    storage = typeof localStorage !== 'undefined' ? localStorage : null,
    _faultInjection = null
} = {}) {
    if (!plan) return;

    if (_faultInjection === 'before_projects_clear') {
        throw new Error('Fault injection: before_projects_clear');
    }

    // 1. Authoritative snapshot replacement for projects
    await idb.clear('projects');

    if (_faultInjection === 'after_projects_clear') {
        throw new Error('Fault injection: after_projects_clear');
    }

    if (Array.isArray(plan.projects) && plan.projects.length > 0) {
        await idb.batchUpdate('projects', plan.projects);
    }

    if (_faultInjection === 'during_project_save') {
        throw new Error('Fault injection: during_project_save');
    }

    // 2. Authoritative snapshot replacement for projectPayrollConfigs
    await idb.clear('projectPayrollConfigs');

    if (_faultInjection === 'after_configs_clear') {
        throw new Error('Fault injection: after_configs_clear');
    }

    if (Array.isArray(plan.projectPayrollConfigs) && plan.projectPayrollConfigs.length > 0) {
        await idb.batchUpdate('projectPayrollConfigs', plan.projectPayrollConfigs);
    }

    if (_faultInjection === 'during_config_save') {
        throw new Error('Fault injection: during_config_save');
    }

    if (_faultInjection === 'during_pointer_save') {
        throw new Error('Fault injection: during_pointer_save');
    }

    // 3. Update localStorage pointers (do NOT swallow exceptions)
    if (storage) {
        if (plan.defaultProjectId) {
            storage.setItem(DEFAULT_PROJECT_LS_KEY, plan.defaultProjectId);
        } else {
            storage.removeItem(DEFAULT_PROJECT_LS_KEY);
        }
        if (plan.activeProjectId) {
            storage.setItem(ACTIVE_PROJECT_LS_KEY, plan.activeProjectId);
        } else {
            storage.removeItem(ACTIVE_PROJECT_LS_KEY);
        }
    }

    // 4. Update in-memory EntityScope ONLY after persisted pointers succeed
    replaceEntityScope({
        enabled: true,
        projectId: plan.activeProjectId,
        defaultProjectId: plan.defaultProjectId
    });
}

/**
 * Reverts all changes back to the pre-mutation rollback snapshot.
 * Aggregates and reports any step failure; verifies saveCore/saveState success.
 */
export async function executeRestoreRollback(snapshot, targetState, {
    idb = indexedDBService,
    storage = typeof localStorage !== 'undefined' ? localStorage : null,
    saveCore = null
} = {}) {
    if (!snapshot) return;

    const rollbackErrors = [];

    // 1. Rollback in-memory core state
    if (targetState && snapshot.coreState) {
        try {
            targetState.settings = clone(snapshot.coreState.settings);
            targetState.positions = clone(snapshot.coreState.positions);
            targetState.employees = clone(snapshot.coreState.employees);
            targetState.leaders = clone(snapshot.coreState.leaders);
            targetState.attendance = clone(snapshot.coreState.attendance);
            targetState.tempAssignments = clone(snapshot.coreState.tempAssignments);
            targetState.dayHoursConfig = clone(snapshot.coreState.dayHoursConfig);

            invalidateAllStats();
            buildAttendanceIndex();
        } catch (e) {
            rollbackErrors.push(new Error(`Core in-memory rollback failed: ${e.message}`));
        }
    }

    // 2. Rollback core stores in IndexedDB
    try {
        if (typeof saveCore === 'function') {
            const ok = await saveCore({ clearFirst: true });
            if (ok !== true) {
                rollbackErrors.push(new Error(`saveCore returned non-true: ${ok}`));
            }
        } else if (idb?.saveState && targetState) {
            const ok = await idb.saveState(targetState, { clearFirst: true });
            if (ok === false) {
                rollbackErrors.push(new Error('idb.saveState returned false'));
            }
        }
    } catch (e) {
        rollbackErrors.push(new Error(`saveCore threw: ${e.message}`));
    }

    // 3. Rollback project stores and pointers if projects were enabled
    if (snapshot.projectsEnabled) {
        try {
            await idb.clear('projects');
            if (Array.isArray(snapshot.projects) && snapshot.projects.length > 0) {
                await idb.batchUpdate('projects', snapshot.projects);
            }
        } catch (e) {
            rollbackErrors.push(new Error(`Rolling back projects store failed: ${e.message}`));
        }

        try {
            await idb.clear('projectPayrollConfigs');
            if (Array.isArray(snapshot.projectPayrollConfigs) && snapshot.projectPayrollConfigs.length > 0) {
                await idb.batchUpdate('projectPayrollConfigs', snapshot.projectPayrollConfigs);
            }
        } catch (e) {
            rollbackErrors.push(new Error(`Rolling back projectPayrollConfigs store failed: ${e.message}`));
        }

        if (storage) {
            try {
                if (snapshot.defaultProjectId !== null && snapshot.defaultProjectId !== undefined) {
                    storage.setItem(DEFAULT_PROJECT_LS_KEY, snapshot.defaultProjectId);
                } else {
                    storage.removeItem(DEFAULT_PROJECT_LS_KEY);
                }
            } catch (e) {
                rollbackErrors.push(new Error(`Rolling back defaultProjectId pointer failed: ${e.message}`));
            }

            try {
                if (snapshot.activeProjectId !== null && snapshot.activeProjectId !== undefined) {
                    storage.setItem(ACTIVE_PROJECT_LS_KEY, snapshot.activeProjectId);
                } else {
                    storage.removeItem(ACTIVE_PROJECT_LS_KEY);
                }
            } catch (e) {
                rollbackErrors.push(new Error(`Rolling back activeProjectId pointer failed: ${e.message}`));
            }
        }

        try {
            if (snapshot.entityScope) {
                replaceEntityScope(snapshot.entityScope);
            }
        } catch (e) {
            rollbackErrors.push(new Error(`Rolling back entityScope failed: ${e.message}`));
        }
    }

    if (typeof window !== 'undefined' && typeof window.render === 'function') {
        try {
            window.render();
        } catch (_) {}
    }

    if (rollbackErrors.length > 0) {
        const aggregateError = new Error(`Restore rollback failed: ${rollbackErrors.map(e => e.message).join('; ')}`);
        aggregateError.rollbackErrors = rollbackErrors;
        throw aggregateError;
    }
}

export default {
    isProjectBackupApplicable,
    resolveRestoredPointers,
    planProjectRestore,
    captureRestoreRollbackSnapshot,
    applyProjectRestore,
    executeRestoreRollback
};
