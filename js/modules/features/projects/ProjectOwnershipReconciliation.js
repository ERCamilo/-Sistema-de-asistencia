/**
 * 🧭 ProjectOwnershipReconciliation.js — R07 A1 (pure domain core)
 *
 * Classifies and plans resolution for project-owned records whose project
 * ownership is missing, dangling, or quarantined. Pure module: no I/O, no
 * global writes, no UI, no persistence (A2 wires that).
 *
 * Classification (mutually exclusive):
 * - VALID:            explicit, catalog-resolvable projectId.
 * - LEGACY_UNSCOPED:  no explicit projectId (may inherit default at write time).
 * - EXPLICIT_ORPHAN:  explicit non-sentinel projectId absent from catalog.
 *   NEVER equivalent to LEGACY_UNSCOPED; never auto-mapped to default/active.
 * - PENDING:          explicit `legacy-unresolved:*` sentinel — reuses the
 *   RecordKey quarantine namespace; no second sentinel system is invented.
 *
 * OFF compatibility: every entry point accepts `enabled:false` scope and
 * returns a no-op passthrough, so legacy control paths are untouched.
 */

export const LEGACY_UNRESOLVED_PREFIX = 'legacy-unresolved:';

export const CLASSIFICATION = Object.freeze({
    VALID: 'VALID',
    LEGACY_UNSCOPED: 'LEGACY_UNSCOPED',
    EXPLICIT_ORPHAN: 'EXPLICIT_ORPHAN',
    PENDING: 'PENDING',
    DISABLED: 'DISABLED'
});

export const RESOLUTION_KIND = Object.freeze({
    NO_ACTION: 'NO_ACTION',
    ASSIGN_TO_SINGLE_VALID: 'ASSIGN_TO_SINGLE_VALID',
    ASSIGN_SELECTED_VALID: 'ASSIGN_SELECTED_VALID',
    REQUIRES_PROJECT_CREATION: 'REQUIRES_PROJECT_CREATION',
    REQUIRES_USER_CHOICE: 'REQUIRES_USER_CHOICE',
    STAYS_PENDING: 'STAYS_PENDING'
});

export const ORPHAN_CHOICES = Object.freeze(['map-to-existing', 'create-new-project', 'resolve-later']);

/** Entity collections scanned by analyzeProjectOwnership, in deterministic order. */
export const PROJECT_OWNED_COLLECTIONS = Object.freeze(['employees', 'positions', 'leaders', 'attendance']);

const ATTENDANCE_COLLECTION = 'attendance';

function trimId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isNonEmptyObject(value) {
    return Boolean(value) && typeof value === 'object';
}

function deepCopy(value) {
    if (value === null || value === undefined) return value;
    // Prefer structuredClone when available (preserves Dates, nested plain
    // data, undefined, etc.); fall back to JSON for environments without it
    // or for values structuredClone cannot clone. Plain-data semantics are
    // preserved either way.
    try {
        if (typeof structuredClone === 'function') {
            return structuredClone(value);
        }
    } catch (_) {
        // fall through to JSON fallback below
    }
    return JSON.parse(JSON.stringify(value));
}

/**
 * Existing `legacy-unresolved:` semantics (RecordKey). Recognizes the single
 * quarantine namespace and produces quarantine projectIds without inventing
 * a second sentinel system.
 */
export function isQuarantineProjectId(projectId) {
    return trimId(projectId).startsWith(LEGACY_UNRESOLVED_PREFIX);
}

export function makeQuarantineProjectId(recordKey) {
    const key = trimId(recordKey);
    if (!key) return null;
    if (isQuarantineProjectId(key)) return key; // idempotent
    return `${LEGACY_UNRESOLVED_PREFIX}${key}`;
}

/** Trimmed, non-empty, non-sentinel projectId — same validity rule as stores. */
export function isExplicitProjectId(projectId) {
    const t = trimId(projectId);
    return Boolean(t) && !t.startsWith(LEGACY_UNRESOLVED_PREFIX);
}

function catalogIdSet(catalog) {
    const ids = new Set();
    for (const p of (Array.isArray(catalog) ? catalog : [])) {
        const id = trimId(p?.id);
        // Match ProjectRegistry/ProjectAdoption validity semantics: sentinel
        // `legacy-unresolved:*` ids are never valid catalog entries.
        if (isExplicitProjectId(id)) ids.add(id);
    }
    return ids;
}

function recordKeyOfListRecord(record, index) {
    const id = trimId(record?.id);
    if (id) return id;
    const num = trimId(record?.number);
    if (num) return `num:${num}`;
    return `index:${index}`;
}

/**
 * Classify one record against a catalog.
 * @returns {{status: string, effectiveProjectId: string|null, explicitProjectId: string|null}}
 */
export function classifyOwnership(record, catalog, { enabled = true, defaultProjectId = null } = {}) {
    if (!enabled) {
        return { status: CLASSIFICATION.DISABLED, effectiveProjectId: null, explicitProjectId: null };
    }
    return classifyOwnershipWithIds(record, catalogIdSet(catalog), { defaultProjectId });
}

function classifyOwnershipWithIds(record, catalogIds, { defaultProjectId = null } = {}) {
    const explicit = trimId(record?.projectId);
    if (!explicit) {
        // No explicit ownership: legacy-unscoped. The scope default (if any) is
        // reported for context but never treated as resolved ownership here.
        const eff = isExplicitProjectId(defaultProjectId) ? trimId(defaultProjectId) : null;
        return { status: CLASSIFICATION.LEGACY_UNSCOPED, effectiveProjectId: eff, explicitProjectId: null };
    }
    if (isQuarantineProjectId(explicit)) {
        return { status: CLASSIFICATION.PENDING, effectiveProjectId: explicit, explicitProjectId: explicit };
    }
    if (catalogIds.has(explicit)) {
        return { status: CLASSIFICATION.VALID, effectiveProjectId: explicit, explicitProjectId: explicit };
    }
    // Explicit non-sentinel id absent from catalog: a true orphan. Distinct
    // from LEGACY_UNSCOPED; must never fall back to the default project.
    return { status: CLASSIFICATION.EXPLICIT_ORPHAN, effectiveProjectId: explicit, explicitProjectId: explicit };
}

/**
 * Deterministic scan over project-owned state.
 *
 * @param {object} state - { employees, positions, leaders, attendance }
 * @param {Array<{id:string}>} catalog - current project catalog
 * @param {object} [opts] - { enabled, defaultProjectId, collections }
 * @returns {{ enabled: boolean, issues: Array, summary: object }}
 *   issues[] = { collection, recordKey, record, status, projectId,
 *                effectiveProjectId, employeeId } — `record` is a deep copy;
 *   mutating returned payloads never touches input state.
 *   summary  = status counts + orphans grouped by projectId + pending grouped
 *   by quarantine id + legacy-unscoped references — all UI-ready (phase B).
 *   summary.counts describes ALL scanned records including VALID so UI can
 *   display e.g. "36 valid + 2 pending"; issues[] stays unresolved-only.
 */
export function analyzeProjectOwnership(state, catalog, opts = {}) {
    const enabled = opts.enabled !== false;
    if (!enabled) {
        return { enabled: false, issues: [], summary: buildEmptySummary() };
    }
    const collections = Array.isArray(opts.collections) && opts.collections.length
        ? opts.collections
        : PROJECT_OWNED_COLLECTIONS;
    const catalogIds = catalogIdSet(catalog);
    const defaultProjectId = opts.defaultProjectId ?? null;

    const issues = [];
    let validCount = 0;
    let totalRecords = 0;
    for (const collection of collections) {
        for (const [recordKey, record] of collectRecords(state?.[collection])) {
            totalRecords += 1;
            const c = classifyOwnershipWithIds(record, catalogIds, { defaultProjectId });
            if (c.status === CLASSIFICATION.VALID) {
                validCount += 1;
                continue;
            }
            issues.push({
                collection,
                recordKey,
                // Deep copy: never expose mutable references to input state.
                record: deepCopy(record),
                status: c.status,
                projectId: c.status === CLASSIFICATION.LEGACY_UNSCOPED ? null : c.explicitProjectId,
                effectiveProjectId: c.effectiveProjectId,
                employeeId: collection === ATTENDANCE_COLLECTION
                    ? trimId(record?.employeeId) || null
                    : trimId(record?.id) || null
            });
        }
    }

    const summary = buildSummary(issues);
    summary.counts[CLASSIFICATION.VALID] = validCount;
    summary.totalRecords = totalRecords;
    summary.issueCount = issues.length;
    return { enabled: true, issues, summary };
}

function collectRecords(value) {
    const rows = [];
    if (Array.isArray(value)) {
        value.forEach((r, i) => {
            if (isNonEmptyObject(r)) rows.push([recordKeyOfListRecord(r, i), r]);
        });
    } else if (isNonEmptyObject(value)) {
        // attendance-style keyed map; sorted keys keep the scan deterministic
        for (const key of Object.keys(value).sort()) {
            if (isNonEmptyObject(value[key])) rows.push([key, value[key]]);
        }
    }
    return rows;
}

function buildEmptySummary() {
    return {
        counts: { VALID: 0, LEGACY_UNSCOPED: 0, EXPLICIT_ORPHAN: 0, PENDING: 0 },
        totalRecords: 0,
        issueCount: 0,
        orphansByProjectId: {},
        pendingByQuarantineId: {},
        legacyUnscoped: []
    };
}

function buildSummary(issues) {
    const summary = buildEmptySummary();
    for (const issue of issues) {
        summary.counts[issue.status] = (summary.counts[issue.status] || 0) + 1;
        if (issue.status === CLASSIFICATION.EXPLICIT_ORPHAN) {
            (summary.orphansByProjectId[issue.projectId] =
                summary.orphansByProjectId[issue.projectId] || []).push(issue);
        } else if (issue.status === CLASSIFICATION.PENDING) {
            (summary.pendingByQuarantineId[issue.projectId] =
                summary.pendingByQuarantineId[issue.projectId] || []).push(issue);
        } else if (issue.status === CLASSIFICATION.LEGACY_UNSCOPED) {
            summary.legacyUnscoped.push(issue);
        }
    }
    return summary;
}

/**
 * Resolution planning per R07 A1 rules. Pure: returns a plan proposal, never
 * applies it and never maps orphans implicitly.
 *
 * @param {object} params
 * @param {string} params.status - classification of the record
 * @param {Array<{id:string}>} params.validProjects - valid catalog projects
 * @param {string} [params.orphanProjectId] - referenced (missing) project id
 * @param {string} [params.requestedChoice] - explicit user choice, when given
 * @param {string} [params.requestedProjectId] - exact existing target selected by the user (legacy alias)
 * @param {string} [params.requestedTargetProjectId] - exact existing target selected by the user (preferred)
 * @param {boolean} [params.enabled=true] - when false, returns disabled no-op instead of R07 behavior
 * @returns {object} plan with `kind`, `assignableProjectId` (or null),
 *   `requiresUserChoice`, `requiresProjectCreation`, `allowedChoices`, `ok`
 *   (+ `disabled`/`enabled` when OFF).
 */
export function planResolution({ status, validProjects = [], orphanProjectId = null, requestedChoice = null, requestedProjectId = null, requestedTargetProjectId = null, enabled = true } = {}) {
    if (enabled === false) {
        return {
            kind: RESOLUTION_KIND.NO_ACTION,
            ok: true,
            assignableProjectId: null,
            requiresUserChoice: false,
            requiresProjectCreation: false,
            allowedChoices: [],
            disabled: true,
            enabled: false,
            reason: 'reconciliation disabled (enabled:false); no R07 action'
        };
    }
    const valid = (Array.isArray(validProjects) ? validProjects : []).filter(p => isExplicitProjectId(p?.id));
    const choice = trimId(requestedChoice) || null;
    // Preferred explicit target param; legacy alias still honored.
    const selectedProjectId = trimId(requestedTargetProjectId) || trimId(requestedProjectId) || null;
    const selectedIsValid = Boolean(selectedProjectId) && valid.some(p => trimId(p?.id) === selectedProjectId);

    if (status === CLASSIFICATION.VALID) {
        // RESOLVED/no-op semantic: nothing to do. Never STAYS_PENDING.
        return basePlan(RESOLUTION_KIND.NO_ACTION, { ok: true });
    }

    if (status === CLASSIFICATION.PENDING) {
        // Quarantined stays pending until explicit resolution, whatever the
        // catalog looks like — even a single valid project is NOT auto-applied.
        if (!choice) {
            return basePlan(RESOLUTION_KIND.STAYS_PENDING, {
                ok: false,
                requiresUserChoice: true,
                allowedChoices: ORPHAN_CHOICES
            });
        }
        if (!ORPHAN_CHOICES.includes(choice)) {
            return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                ok: false,
                requiresUserChoice: true,
                allowedChoices: ORPHAN_CHOICES,
                reason: `invalid choice "${choice}" for a quarantined record`,
                chosenChoice: choice
            });
        }
        if (choice === 'resolve-later') {
            return basePlan(RESOLUTION_KIND.STAYS_PENDING, {
                ok: true,
                requiresUserChoice: false,
                allowedChoices: ORPHAN_CHOICES,
                chosenChoice: choice
            });
        }
        if (choice === 'create-new-project') {
            return basePlan(RESOLUTION_KIND.REQUIRES_PROJECT_CREATION, {
                ok: true,
                requiresUserChoice: false,
                requiresProjectCreation: true,
                allowedChoices: ORPHAN_CHOICES,
                chosenChoice: choice
            });
        }
        // choice === 'map-to-existing': same safe pathways as explicit orphans.
        if (selectedProjectId) {
            if (!selectedIsValid) {
                return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                    ok: false,
                    requiresUserChoice: true,
                    allowedChoices: ORPHAN_CHOICES,
                    reason: `selected project "${selectedProjectId}" is not in the valid catalog`,
                    chosenChoice: choice
                });
            }
            return basePlan(RESOLUTION_KIND.ASSIGN_SELECTED_VALID, {
                ok: true,
                assignableProjectId: selectedProjectId,
                requiresUserChoice: false,
                allowedChoices: ORPHAN_CHOICES,
                chosenChoice: choice
            });
        }
        if (valid.length === 1) {
            return basePlan(RESOLUTION_KIND.ASSIGN_SELECTED_VALID, {
                ok: true,
                assignableProjectId: trimId(valid[0].id),
                requiresUserChoice: false,
                allowedChoices: ORPHAN_CHOICES,
                chosenChoice: choice
            });
        }
        return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
            ok: false,
            requiresUserChoice: true,
            allowedChoices: ORPHAN_CHOICES,
            reason: 'map-to-existing requires an explicit target project',
            chosenChoice: choice
        });
    }

    if (status === CLASSIFICATION.LEGACY_UNSCOPED) {
        if (valid.length === 1) {
            const target = trimId(valid[0].id);
            if (choice && choice !== 'map-to-existing') {
                return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                    ok: false,
                    requiresUserChoice: true,
                    allowedChoices: ['map-to-existing'],
                    reason: 'the only deterministic choice with a single valid project is map-to-existing'
                });
            }
            if (selectedProjectId && selectedProjectId !== target) {
                return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                    ok: false,
                    requiresUserChoice: true,
                    allowedChoices: ['map-to-existing'],
                    reason: `selected project "${selectedProjectId}" is not the single valid project`
                });
            }
            return basePlan(RESOLUTION_KIND.ASSIGN_TO_SINGLE_VALID, {
                ok: true,
                assignableProjectId: target,
                allowedChoices: ['map-to-existing']
            });
        }
        if (valid.length === 0) {
            return basePlan(RESOLUTION_KIND.REQUIRES_PROJECT_CREATION, {
                ok: false,
                requiresProjectCreation: true,
                allowedChoices: ['create-new-project'],
                reason: 'no valid project exists; one real project must be created before assignment'
            });
        }
        if (choice === 'map-to-existing' && selectedIsValid) {
            return basePlan(RESOLUTION_KIND.ASSIGN_SELECTED_VALID, {
                ok: true,
                assignableProjectId: selectedProjectId,
                allowedChoices: ['map-to-existing'],
                chosenChoice: choice
            });
        }
        if (choice === 'map-to-existing' && selectedProjectId && !selectedIsValid) {
            return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                ok: false,
                requiresUserChoice: true,
                allowedChoices: ['map-to-existing'],
                reason: `selected project "${selectedProjectId}" is not in the valid catalog`
            });
        }
        return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
            ok: false,
            requiresUserChoice: true,
            allowedChoices: ['map-to-existing'],
            reason: 'multiple valid projects require an explicit target project'
        });
    }

    if (status === CLASSIFICATION.EXPLICIT_ORPHAN) {
        // Requires explicit choice unless the referenced project definition is
        // restored separately (out of A1 scope). Never auto-maps.
        if (choice && !ORPHAN_CHOICES.includes(choice)) {
            return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                ok: false,
                requiresUserChoice: true,
                allowedChoices: ORPHAN_CHOICES,
                reason: `invalid choice "${choice}" for an explicit orphan`
            });
        }
        if (choice === 'map-to-existing') {
            if (selectedProjectId) {
                if (!selectedIsValid) {
                    return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                        ok: false,
                        requiresUserChoice: true,
                        allowedChoices: ORPHAN_CHOICES,
                        reason: `selected project "${selectedProjectId}" is not in the valid catalog`,
                        chosenChoice: choice,
                        orphanProjectId
                    });
                }
                return basePlan(RESOLUTION_KIND.ASSIGN_SELECTED_VALID, {
                    ok: true,
                    assignableProjectId: selectedProjectId,
                    requiresUserChoice: false,
                    allowedChoices: ORPHAN_CHOICES,
                    chosenChoice: choice,
                    orphanProjectId
                });
            }
            if (valid.length === 1) {
                return basePlan(RESOLUTION_KIND.ASSIGN_SELECTED_VALID, {
                    ok: true,
                    assignableProjectId: trimId(valid[0].id),
                    requiresUserChoice: false,
                    allowedChoices: ORPHAN_CHOICES,
                    chosenChoice: choice,
                    orphanProjectId
                });
            }
            return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
                ok: false,
                requiresUserChoice: true,
                allowedChoices: ORPHAN_CHOICES,
                reason: 'map-to-existing requires an explicit target project',
                chosenChoice: choice,
                orphanProjectId
            });
        }
        // Post-choice normalization (removes A2 ambiguity): an explicit valid
        // choice resolves the "requires user choice" flag. create-new-project
        // leaves quarantine/orphan via project creation; resolve-later stays
        // pending but acknowledged (ok:true). Without a choice, orphan still
        // requires user choice.
        if (choice === 'create-new-project') {
            return basePlan(RESOLUTION_KIND.REQUIRES_PROJECT_CREATION, {
                ok: true,
                requiresUserChoice: false,
                requiresProjectCreation: true,
                allowedChoices: ORPHAN_CHOICES,
                chosenChoice: choice,
                orphanProjectId
            });
        }
        if (choice === 'resolve-later') {
            return basePlan(RESOLUTION_KIND.STAYS_PENDING, {
                ok: true,
                requiresUserChoice: false,
                allowedChoices: ORPHAN_CHOICES,
                chosenChoice: choice,
                orphanProjectId
            });
        }
        return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
            ok: false,
            requiresUserChoice: true,
            allowedChoices: ORPHAN_CHOICES,
            chosenChoice: choice || undefined,
            orphanProjectId
        });
    }

    return basePlan(RESOLUTION_KIND.REQUIRES_USER_CHOICE, {
        ok: false,
        requiresUserChoice: true,
        reason: `unknown status "${status}"`
    });
}

function basePlan(kind, { ok = false, assignableProjectId = null, requiresUserChoice = false, requiresProjectCreation = false, allowedChoices = [], reason, chosenChoice, orphanProjectId } = {}) {
    const plan = {
        kind,
        ok,
        assignableProjectId,
        requiresUserChoice,
        requiresProjectCreation,
        allowedChoices
    };
    if (reason !== undefined) plan.reason = reason;
    if (chosenChoice !== undefined) plan.chosenChoice = chosenChoice;
    if (orphanProjectId !== null && orphanProjectId !== undefined) plan.orphanProjectId = orphanProjectId;
    return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure employee reassignment (A1: all-or-nothing plan construction only;
// transaction/persistence wiring is A2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect attendance entries preserving whether the key is a real keyed-map
 * key (canonical `employeeId-date`) or a synthetic list key. Array inputs and
 * synthetic `num:`/`index:` (any `:`-containing) keys are never treated as
 * canonical map keys.
 */
function collectAttendanceEntries(attendance) {
    const entries = [];
    if (Array.isArray(attendance)) {
        attendance.forEach((r, i) => {
            if (isNonEmptyObject(r)) entries.push({ key: recordKeyOfListRecord(r, i), record: r, isMapKey: false });
        });
    } else if (isNonEmptyObject(attendance)) {
        for (const key of Object.keys(attendance).sort()) {
            if (isNonEmptyObject(attendance[key])) entries.push({ key, record: attendance[key], isMapKey: true });
        }
    }
    return entries;
}

function isSyntheticMapKey(key) {
    return typeof key === 'string' && key.includes(':');
}

/**
 * Build an all-or-nothing reassignment plan for one employee.
 *
 * Rewrites ONLY project ownership: the employee's projectId and the projectId
 * of attendance records that CLEARLY belong to that employee. Preserves the
 * employee id, number-derived key, and embedded loans untouched.
 *
 * Requires a stable `employee.id`: a number-only employee can never produce a
 * successful plan because dependent attendance (keyed by stable id) cannot be
 * identified safely.
 *
 * For keyed attendance maps, canonical ownership (`employeeId + '-' + date`)
 * is validated with exact canonical equality plus safe namespace-prefix
 * (`employeeId + '-'`) fail-closed:
 * - a map key occupying this employee's canonical namespace (safe delimiter
 *   prefix `employeeId + '-'`) whose payload employeeId/date disagree fails
 *   closed — including date-mismatched claims such as key
 *   `emp-34-2026-09-18` with payload `emp-405`/`2026-09-19` — and
 * - a payload owned by this employee whose map key contradicts its canonical
 *   key fails closed.
 * Exact equality (never substring) plus the delimiter-inclusive prefix keep
 * `emp-1` from claiming `emp-10`. Array inputs and synthetic (`:`-containing)
 * list keys are never treated as canonical map keys.
 * Other employees' valid attendance is untouched. Exact canonical equality is
 * used throughout — never substring/prefix matching — so `emp-1` never claims
 * `emp-10`. Array inputs and synthetic (`:`-containing) list keys are never
 * treated as canonical map keys.
 *
 * Fails closed (returns { ok:false, conflicts } with no partial output) when:
 * - reconciliation is disabled is handled separately (disabled no-op shape),
 * - the employee lacks a stable id, or
 * - the target projectId is invalid (empty or quarantine sentinel), or
 * - the target is not present in the catalog, or
 * - canonical attendance ownership is ambiguous (see above).
 *
 * @param {object} params
 * @param {object} params.employee
 * @param {object|Array} [params.attendance] - keyed map or array of records
 * @param {string} params.targetProjectId
 * @param {Array<{id:string}>} params.catalog
 * @param {boolean} [params.enabled=true] - when false, returns disabled no-op without mutating
 * @returns {object} { ok, employee, attendanceRecords, conflicts } — deep
 *   copies; inputs are never mutated. When disabled: { ok:false, disabled:true,
 *   enabled:false, employee:null, attendanceRecords:null, conflicts:[] }.
 */
/**
 * Match attendance records canonically owned by `employee` (fail-closed).
 *
 * Shared ownership-matcher for reassignment planning (A1) and the durable
 * repair/QUARANTINE flows (A2). `matched` holds `{ key, record }` with the
 * ORIGINAL record references (NOT copies) — callers must deep-copy before
 * mutating. `conflicts` lists canonical-ownership violations using the same
 * exact-equality plus safe delimiter-prefix rules as the planner: arrays and
 * synthetic (`:`-containing) list keys are never treated as canonical map
 * keys, and `emp-1` never claims `emp-10`.
 */
export function matchEmployeeAttendance(employee, attendance = {}) {
    const conflicts = [];
    const matched = [];
    const empId = isNonEmptyObject(employee) ? trimId(employee.id) : '';
    if (!isNonEmptyObject(employee) || !empId) {
        return { ok: false, matched, conflicts };
    }

    for (const { key, record, isMapKey } of collectAttendanceEntries(attendance)) {
        const owner = trimId(record?.employeeId);
        const date = trimId(record?.date);
        const hasCanonical = Boolean(owner) && Boolean(date);
        const canonicalForRecord = hasCanonical ? `${owner}-${date}` : null;
        const expectedForEmp = date ? `${empId}-${date}` : null;
        const synthetic = isSyntheticMapKey(key);

        if (owner === empId) {
            if (isMapKey && !synthetic && hasCanonical && key !== canonicalForRecord) {
                conflicts.push({
                    code: 'ATTENDANCE_KEY_MISMATCH',
                    message: `attendance record "${key}" is owned by "${empId}" but its canonical key should be "${canonicalForRecord}"`,
                    attendanceKey: key,
                    expectedAttendanceKey: canonicalForRecord,
                    expectedEmployeeId: empId,
                    actualEmployeeId: owner
                });
                continue;
            }
            matched.push({ key, record });
        } else {
            if (isMapKey && !synthetic) {
                const exactClaim = Boolean(expectedForEmp) && key === expectedForEmp;
                const namespaceClaim = key.startsWith(`${empId}-`);
                if (exactClaim || namespaceClaim) {
                    conflicts.push({
                        code: 'ATTENDANCE_EMPLOYEE_MISMATCH',
                        message: `attendance record "${key}" is keyed for "${empId}" but its employeeId is "${owner || '(missing)'}"`,
                        attendanceKey: key,
                        expectedEmployeeId: empId,
                        actualEmployeeId: owner || null
                    });
                }
            }
        }
    }
    return { ok: conflicts.length === 0, matched, conflicts };
}

export function planEmployeeProjectReassignment({ employee, attendance = {}, targetProjectId, catalog = [], enabled = true } = {}) {
    if (enabled === false) {
        return {
            ok: false,
            disabled: true,
            enabled: false,
            employee: null,
            attendanceRecords: null,
            conflicts: [],
            reason: 'reconciliation disabled (enabled:false); no R07 plan'
        };
    }
    const conflicts = [];
    const target = trimId(targetProjectId);
    const catalogIds = catalogIdSet(catalog);

    const empId = isNonEmptyObject(employee) ? trimId(employee.id) : '';
    if (!isNonEmptyObject(employee) || !empId) {
        conflicts.push({ code: 'INVALID_EMPLOYEE', message: 'employee.id (stable id) is required; number-only employees cannot be reassigned safely' });
    }
    if (!isExplicitProjectId(target)) {
        conflicts.push({
            code: 'INVALID_TARGET_PROJECT',
            message: 'target projectId must be a non-empty, non-quarantine id'
        });
    } else if (!catalogIds.has(target)) {
        conflicts.push({ code: 'TARGET_PROJECT_NOT_IN_CATALOG', message: `project "${target}" does not exist in the catalog` });
    }

    // Canonical attendance ownership (fail-closed) — shared with the durable
    // repair flows via matchEmployeeAttendance.
    const match = matchEmployeeAttendance(employee, attendance);
    conflicts.push(...match.conflicts);

    if (conflicts.length) return { ok: false, employee: null, attendanceRecords: null, conflicts };

    // A valid explicit employee project is durable identity when this plan is
    // reconciling an attendance-only issue. Direct employee reassignment remains
    // available for an employee with no attendance issue (legacy planner API).
    const currentProjectId = trimId(employee.projectId);
    const employeeHasValidProject = isExplicitProjectId(currentProjectId)
        && catalogIds.has(currentProjectId);
    const attendanceNeedsReconciliation = match.matched.some(({ record }) => {
        const attendanceProjectId = trimId(record?.projectId);
        return !attendanceProjectId
            || !catalogIds.has(attendanceProjectId)
            || isQuarantineProjectId(attendanceProjectId);
    });
    const employeeNeedsOwnershipRepair = !employeeHasValidProject || !attendanceNeedsReconciliation;

    // All-or-nothing output: fresh deep copies, inputs untouched.
    const plannedEmployee = deepCopy(employee);
    if (employeeNeedsOwnershipRepair) plannedEmployee.projectId = target;

    const plannedAttendance = match.matched.map(({ key, record }) => {
        const rec = deepCopy(record);
        const currentProjectId = trimId(record?.projectId);

        // R07 Phase B: reparar pertenencia actual NO equivale a trasladar
        // historial. Una asistencia que ya pertenece a una obra válida puede
        // ser historia legítima y se conserva aunque difiera del destino.
        // Solo se corrigen referencias explícitas no resolubles/cuarentenadas
        // y las de pertenencia vacía/ausente (huérfano inequívoco del empleado).
        if (!currentProjectId) {
            // F3: projectId vacío/ausente = huérfano inequívoco de este
            // empleado → se reconcilia a la obra destino.
            rec.projectId = target;
        } else if (!catalogIds.has(currentProjectId) || isQuarantineProjectId(currentProjectId)) {
            rec.projectId = target;
        }
        return { key, record: rec };
    });

    return { ok: true, employee: plannedEmployee, attendanceRecords: plannedAttendance, conflicts: [] };
}

export default {
    LEGACY_UNRESOLVED_PREFIX,
    CLASSIFICATION,
    RESOLUTION_KIND,
    ORPHAN_CHOICES,
    PROJECT_OWNED_COLLECTIONS,
    isQuarantineProjectId,
    makeQuarantineProjectId,
    isExplicitProjectId,
    classifyOwnership,
    analyzeProjectOwnership,
    planResolution,
    planEmployeeProjectReassignment,
    matchEmployeeAttendance
};
