/**
 * 📦 ProjectBackupManifest.js (F1.9 S1)
 *
 * Pure preflight for project-aware FILE backups. No IO, no mutation:
 * - never reads/writes IndexedDB, localStorage, Firebase, registry, pointers
 * - never rewrites projectId, creates/adopts projects, switches active/default,
 *   writes markers, deletes/recalcs closures/configs/petty, or widens clearFirst
 *
 * Two entry points (both pure, inputs never mutated):
 * - buildProjectBackupManifest(...) → manifest object embedded on ON export
 * - diagnoseProjectBackup(backupData, localContext) → read-only diagnostics
 *   for RestoreUI display/guarding. Current restore semantics stay
 *   default-preserve: diagnostics never trigger writes.
 *
 * Effective ownership follows F0.4 §2 (read rule, zero writes):
 *   effectiveProjectId = entity.projectId ?? defaultProjectId ?? null
 *
 * Petty rule (F1.7 frozen): ONLY pettyCash.projects[].officialProjectId is
 * canonical linkage. periods/movements internal `projectId` is NEVER read
 * here (see petty diagnostics — internalProjectIdIgnored:true).
 */

export const PROJECT_BACKUP_MANIFEST_VERSION = 1;

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}

/** Same validity as stores: trimmed non-empty, never legacy-unresolved sentinel. */
export function isValidBackupProjectId(id) {
    if (typeof id !== 'string') return false;
    const t = id.trim();
    return Boolean(t) && !t.startsWith('legacy-unresolved:');
}

function normalizeId(id) {
    return isValidBackupProjectId(id) ? String(id).trim() : null;
}

/**
 * Effective project for counting (F0.4 §2). Mirrors
 * EntityProjectScope.effectiveProjectId without importing scope state:
 * entity.projectId ?? defaultProjectId ?? null (no coercion of '' — byte-stable).
 */
export function getEffectiveBackupProjectId(entity, defaultProjectId) {
    if (!isRecord(entity)) return defaultProjectId ?? null;
    const pid = entity.projectId;
    if (pid === undefined || pid === null) return defaultProjectId ?? null;
    return pid ?? defaultProjectId ?? null;
}

export function hasOwnProjectId(entity) {
    return hasOwn(entity, 'projectId');
}

/** Container handles both current {data:{}} and legacy flat shapes. Never throws. */
export function getBackupContainer(backupData) {
    if (!isRecord(backupData)) return {};
    const inner = backupData.data;
    if (isRecord(inner)) return inner;
    return backupData;
}

/** True when the file carries any S1 project surface (data.* or top-level). */
export function hasProjectBackupMetadata(backupData) {
    if (!isRecord(backupData)) return false;
    const container = getBackupContainer(backupData);
    if (hasOwn(container, 'projects') || hasOwn(container, 'projectPayrollConfigs') || hasOwn(container, 'projectBackup')) {
        return true;
    }
    if (hasOwn(backupData, 'projectBackup') || hasOwn(backupData, 'projects') || hasOwn(backupData, 'projectPayrollConfigs')) {
        return true;
    }
    if (isRecord(backupData.meta) && (hasOwn(backupData.meta, 'projectBackup') || hasOwn(backupData.meta, 'projects'))) {
        return true;
    }
    return false;
}

export function isLegacyProjectBackup(backupData) {
    return !hasProjectBackupMetadata(backupData);
}

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function toAttendanceList(attendance) {
    if (!isRecord(attendance)) return [];
    return Object.values(attendance).filter(isRecord);
}

function sortedUnique(list) {
    return [...new Set((list || []).filter((v) => typeof v === 'string' && v))].sort();
}

/**
 * Distinct backup project IDs (direct `projectId` values + projects[] ids).
 * Informational only — never writes.
 */
export function collectBackupProjectIds(backupData) {
    const c = getBackupContainer(backupData);
    const ids = [];
    for (const e of toArray(c.employees)) {
        if (e && e.projectId != null && typeof e.projectId === 'string' && e.projectId) ids.push(e.projectId);
    }
    for (const p of toArray(c.positions)) {
        if (p && p.projectId != null && typeof p.projectId === 'string' && p.projectId) ids.push(p.projectId);
    }
    for (const l of toArray(c.leaders)) {
        if (l && l.projectId != null && typeof l.projectId === 'string' && l.projectId) ids.push(l.projectId);
    }
    for (const r of toAttendanceList(c.attendance)) {
        if (r && r.projectId != null && typeof r.projectId === 'string' && r.projectId) ids.push(r.projectId);
    }
    for (const p of toArray(c.projects)) {
        if (p && typeof p.id === 'string' && p.id) ids.push(p.id);
    }
    const manifest = isRecord(c.projectBackup) ? c.projectBackup : (isRecord(backupData.projectBackup) ? backupData.projectBackup : null);
    if (manifest && Array.isArray(manifest.projectIds)) {
        for (const id of manifest.projectIds) {
            if (typeof id === 'string' && id) ids.push(id);
        }
    }
    return sortedUnique(ids);
}

function countListByEffective(list, defaultProjectId) {
    const perProject = {};
    let unstamped = 0;
    for (const item of list) {
        if (!isRecord(item)) continue;
        if (item.projectId === undefined || item.projectId === null) unstamped += 1;
        const eff = getEffectiveBackupProjectId(item, defaultProjectId);
        const key = eff == null ? '__unresolved__' : String(eff);
        perProject[key] = (perProject[key] || 0) + 1;
    }
    return { total: list.length, unstamped, perProject };
}

/**
 * Pure manifest builder for ON export. Reads only — never mutates inputs.
 * Callers gather projects/configs/pointers via existing read APIs and pass
 * them here; this function only counts.
 */
export function buildProjectBackupManifest({
    employees = [],
    positions = [],
    leaders = [],
    attendance = {},
    projects = [],
    projectPayrollConfigs = [],
    defaultProjectId = null,
    activeProjectId = null,
    exportedAt = null
} = {}) {
    const empList = toArray(employees).filter(isRecord);
    const posList = toArray(positions).filter(isRecord);
    const leadList = toArray(leaders).filter(isRecord);
    const attList = toAttendanceList(attendance);
    const projList = toArray(projects).filter(isRecord);
    const cfgList = toArray(projectPayrollConfigs).filter(isRecord);

    const projectIds = sortedUnique([
        ...empList.map((e) => (typeof e.projectId === 'string' && e.projectId ? e.projectId : null)).filter(Boolean),
        ...posList.map((p) => (typeof p.projectId === 'string' && p.projectId ? p.projectId : null)).filter(Boolean),
        ...leadList.map((l) => (typeof l.projectId === 'string' && l.projectId ? l.projectId : null)).filter(Boolean),
        ...attList.map((r) => (typeof r.projectId === 'string' && r.projectId ? r.projectId : null)).filter(Boolean),
        ...projList.map((p) => (typeof p.id === 'string' && p.id ? p.id : null)).filter(Boolean)
    ]);

    return {
        version: PROJECT_BACKUP_MANIFEST_VERSION,
        projectsEnabled: true,
        exportedAt,
        defaultProjectId: defaultProjectId ?? null,
        activeProjectId: activeProjectId ?? null,
        projectIds,
        configProjectIds: sortedUnique(cfgList.map((c) => (typeof c.projectId === 'string' && c.projectId ? c.projectId : null)).filter(Boolean)),
        counts: {
            employees: countListByEffective(empList, defaultProjectId ?? null),
            positions: countListByEffective(posList, defaultProjectId ?? null),
            leaders: countListByEffective(leadList, defaultProjectId ?? null),
            attendance: countListByEffective(attList, defaultProjectId ?? null),
            projects: { total: projList.length },
            projectPayrollConfigs: { total: cfgList.length }
        }
    };
}

function readManifestPointers(backupData) {
    const c = getBackupContainer(backupData);
    const m = isRecord(c.projectBackup) ? c.projectBackup : (isRecord(backupData.projectBackup) ? backupData.projectBackup : null);
    if (!m) return { backupDefaultProjectId: null, backupActiveProjectId: null, backupCanonicalProjectId: null };
    return {
        backupDefaultProjectId: m.defaultProjectId ?? null,
        backupActiveProjectId: m.activeProjectId ?? null,
        backupCanonicalProjectId: m.canonicalProjectId ?? null
    };
}

function getKnownOfficialIds(localProjectIds, backupProjectIds) {
    return sortedUnique([...(localProjectIds || []), ...(backupProjectIds || [])]);
}

/** F1.7: ONLY officialProjectId counts. periods/movements never inspected. */
function diagnosePettyOfficialLinks(backupPettyCash, knownOfficialIds) {
    const projects = isRecord(backupPettyCash) ? toArray(backupPettyCash.projects) : [];
    let orphanMissing = 0;
    let orphanInvalid = 0;
    const orphanIds = [];
    const known = new Set((knownOfficialIds || []).map((v) => String(v)));
    for (const p of projects) {
        if (!isRecord(p)) continue;
        const raw = hasOwn(p, 'officialProjectId') ? p.officialProjectId : undefined;
        const link = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
        if (!link) {
            orphanMissing += 1;
            if (p.id != null) orphanIds.push(String(p.id));
            continue;
        }
        if (known.size > 0 && !known.has(link)) {
            orphanInvalid += 1;
            if (p.id != null) orphanIds.push(String(p.id));
        }
    }
    return {
        totalPettyProjects: projects.length,
        orphanMissing,
        orphanInvalid,
        orphanIds: orphanIds.slice(0, 50),
        internalProjectIdIgnored: true
    };
}

function countUnrecoverableReceipts(backupPettyCash) {
    const movements = isRecord(backupPettyCash) ? toArray(backupPettyCash.movements) : [];
    let unrecoverableReceiptCount = 0;
    for (const m of movements) {
        if (!isRecord(m)) continue;
        const onlyLocal = Boolean(m.hasReceipt) && !m.receiptUrl && m.receiptStorage !== 'supabase';
        if (onlyLocal) unrecoverableReceiptCount += 1;
    }
    return { unrecoverableReceiptCount, hasLoss: unrecoverableReceiptCount > 0 };
}

/**
 * Diagnose an imported backup against local context. Pure + read-only.
 *
 * @param {object} backupData — parsed backup file ({data:{}} or legacy flat).
 * @param {object} localContext — {
 *   localProjects?: Array, localProjectIds?: string[],
 *   defaultProjectId?: string|null, activeProjectId?: string|null,
 *   canonicalProjectId?: string|null,
 *   localClosures?: Array<{id, projectId, rows?:Array<{employeeId}>}>,
 *   localPayrollConfigs?: Array, localPettyCash?: {projects,periods,movements}
 * }
 * localPettyCash is accepted but NEVER used for linkage decisions here —
 * only backup petty is diagnosed (local stays untouched by contract).
 */
export function diagnoseProjectBackup(backupData, localContext = {}) {
    const container = getBackupContainer(backupData);
    const ctx = isRecord(localContext) ? localContext : {};

    const hasProjectMetadata = hasProjectBackupMetadata(backupData);
    const isLegacy = !hasProjectMetadata;

    const backupEmployees = toArray(container.employees).filter(isRecord);
    const backupPositions = toArray(container.positions).filter(isRecord);
    const backupLeaders = toArray(container.leaders).filter(isRecord);
    const backupAttendance = toAttendanceList(container.attendance);
    const backupProjects = toArray(container.projects).filter(isRecord);
    const backupConfigs = toArray(container.projectPayrollConfigs).filter(isRecord);
    const backupPettyCash = isRecord(container.pettyCash) ? container.pettyCash : null;

    const manifestPointers = readManifestPointers(backupData);
    const manifestDefault = manifestPointers.backupDefaultProjectId ?? null;

    const backupProjectIds = collectBackupProjectIds(backupData);
    const backupProjectIdSet = new Set(backupProjectIds.map(String));

    const localProjects = Array.isArray(ctx.localProjects) ? ctx.localProjects.filter(isRecord) : [];
    const localProjectIds = Array.isArray(ctx.localProjectIds)
        ? sortedUnique(ctx.localProjectIds.filter((v) => typeof v === 'string' && v))
        : sortedUnique(localProjects.map((p) => (typeof p.id === 'string' && p.id ? p.id : null)).filter(Boolean));
    const localProjectIdSet = new Set(localProjectIds.map(String));

    const localDefaultProjectId = ctx.defaultProjectId ?? null;
    const localActiveProjectId = ctx.activeProjectId ?? null;
    const localCanonicalProjectId = ctx.canonicalProjectId ?? null;

    const backupCounts = {
        employees: countListByEffective(backupEmployees, manifestDefault),
        positions: countListByEffective(backupPositions, manifestDefault),
        leaders: countListByEffective(backupLeaders, manifestDefault),
        attendance: countListByEffective(backupAttendance, manifestDefault)
    };
    const legacyCounts = {
        employees: backupCounts.employees.unstamped,
        positions: backupCounts.positions.unstamped,
        leaders: backupCounts.leaders.unstamped,
        attendance: backupCounts.attendance.unstamped
    };

    // Foreign = backup IDs not known locally. Missing definitions = roster IDs
    // without a matching entry in backup projects[] (informational).
    const foreignProjectIds = backupProjectIds.filter((id) => !localProjectIdSet.has(String(id)));
    const backupDefinedIds = new Set(backupProjects.map((p) => (typeof p.id === 'string' ? p.id : null)).filter(Boolean).map(String));
    const missingProjectDefinitions = backupProjectIds.filter((id) => !backupDefinedIds.has(String(id)));

    const backupConfigIds = new Set(backupConfigs.map((c) => (typeof c.projectId === 'string' ? c.projectId : null)).filter(Boolean).map(String));
    const missingConfigProjectIds = backupProjectIds.filter((id) => !backupConfigIds.has(String(id)));

    const pointerInfo = {
        backupDefaultProjectId: manifestPointers.backupDefaultProjectId,
        backupActiveProjectId: manifestPointers.backupActiveProjectId,
        localDefaultProjectId,
        localActiveProjectId,
        defaultMatch: (manifestPointers.backupDefaultProjectId ?? null) === (localDefaultProjectId ?? null),
        activeMatch: (manifestPointers.backupActiveProjectId ?? null) === (localActiveProjectId ?? null)
    };
    const canonicalInfo = {
        backupCanonicalProjectId: manifestPointers.backupCanonicalProjectId,
        localCanonicalProjectId,
        match: (manifestPointers.backupCanonicalProjectId ?? null) === (localCanonicalProjectId ?? null)
    };

    // Closure orphan risk (read-only): local closures stay untouched; we only
    // report which ones reference projects/employees absent from the BACKUP
    // roster (they would look orphaned if the roster were applied as-is).
    const localClosures = Array.isArray(ctx.localClosures) ? ctx.localClosures.filter(isRecord) : [];
    const backupEmployeeIds = new Set(backupEmployees.map((e) => (e.id != null ? String(e.id) : null)).filter(Boolean));
    const atRiskIds = [];
    for (const closure of localClosures) {
        if (!isRecord(closure) || closure.id == null) continue;
        let atRisk = false;
        let reason = null;
        if (closure.projectId != null && typeof closure.projectId === 'string' && closure.projectId) {
            if (!backupProjectIdSet.has(String(closure.projectId))) {
                atRisk = true;
                reason = 'project-missing-in-backup';
            }
        }
        if (!atRisk && Array.isArray(closure.rows)) {
            for (const row of closure.rows) {
                if (!isRecord(row) || row.employeeId == null) continue;
                if (!backupEmployeeIds.has(String(row.employeeId))) {
                    atRisk = true;
                    reason = reason || 'employee-missing-in-backup';
                    break;
                }
            }
        }
        if (atRisk) {
            atRiskIds.push(String(closure.id));
            if (atRiskIds.length >= 50) break;
        }
    }
    const closureRisks = {
        localClosureCount: localClosures.length,
        atRiskCount: atRiskIds.length,
        atRiskIds
    };

    const knownOfficialIds = getKnownOfficialIds(localProjectIds, backupProjectIds);
    const petty = diagnosePettyOfficialLinks(backupPettyCash, knownOfficialIds);
    const receiptLoss = countUnrecoverableReceipts(backupPettyCash);

    const warnings = [];
    if (isLegacy) warnings.push('legacy-no-project');
    if (foreignProjectIds.length > 0) warnings.push('foreign-project');
    if (missingProjectDefinitions.length > 0 && hasProjectMetadata) warnings.push('missing-project-definition');
    if (missingConfigProjectIds.length > 0 && hasProjectMetadata) warnings.push('payroll-config-gap');
    if (closureRisks.atRiskCount > 0) warnings.push('closure-orphan-risk');
    if (petty.orphanMissing > 0 || petty.orphanInvalid > 0) warnings.push('petty-orphan');
    if (receiptLoss.hasLoss) warnings.push('receipt-loss');
    if (hasProjectMetadata && (!pointerInfo.defaultMatch || !pointerInfo.activeMatch)) warnings.push('pointer-mismatch');

    return {
        hasProjectMetadata,
        isLegacyBackup: isLegacy,
        backupProjectIds,
        backupCounts,
        legacyCounts,
        foreignProjectIds,
        missingProjectDefinitions,
        missingConfigProjectIds,
        pointerInfo,
        canonicalInfo,
        closureRisks,
        petty,
        receiptLoss,
        warnings
    };
}

export default {
    PROJECT_BACKUP_MANIFEST_VERSION,
    isValidBackupProjectId,
    getEffectiveBackupProjectId,
    hasOwnProjectId,
    getBackupContainer,
    hasProjectBackupMetadata,
    isLegacyProjectBackup,
    collectBackupProjectIds,
    buildProjectBackupManifest,
    diagnoseProjectBackup
};
