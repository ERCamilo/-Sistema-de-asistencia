/**
 * Local, reversible visibility decisions for unresolvable Multiobra issues.
 * Never edits employees, closures, loans, attendance or project ownership.
 * The archive is namespaced by Firebase UID to avoid exposing another
 * account's decisions on shared devices. It is NOT cloud-synchronized.
 */
import indexedDBService from '../../services/IndexedDBService.js';
import { auth } from '../../data/firebase.js';

const ARCHIVE_PREFIX = 'multiobra:conflict-archive:v1:';
const text = value => String(value ?? '').trim();
const array = value => Array.isArray(value) ? value : [];

export function conflictCaseKey(kind, key) {
    const category = text(kind), id = text(key);
    if (!category || !id) throw new Error('El conflicto necesita un identificador estable.');
    return category + ':' + id;
}

/** Returns opaque stable ids and nonfinancial presentation metadata only. */
export function collectProjectConflictCases(model = {}) {
    const result = [];
    for (const item of array(model.employeeRows)) {
        if (!item?.id) continue;
        result.push({
            id: conflictCaseKey('employee', item.id),
            label: 'Empleado ' + text(item.employee?.number || item.id),
            reason: text(item.status || 'Sin obra válida'),
            kind: 'employee'
        });
    }
    for (const item of array(model.otherIssues)) {
        if (!item?.collection || !item?.recordKey) continue;
        result.push({
            id: conflictCaseKey(item.collection, item.recordKey),
            label: text(item.collection) + ' · ' + text(item.recordKey),
            reason: text(item.status || 'Sin obra válida'),
            kind: 'entity'
        });
    }
    // Attendance whose employee no longer exists is intentionally absent
    // from employeeRows/otherIssues; it still needs a reversible archive.
    for (const key of array(model.orphanAttendanceKeys)) {
        if (!text(key)) continue;
        result.push({
            id: conflictCaseKey('orphanAttendance', key),
            label: 'Asistencia sin empleado · ' + text(key),
            reason: 'Asistencia sin empleado original',
            kind: 'attendance'
        });
    }
    for (const item of array(model.pettyCashRows)) {
        if (!item?.id) continue;
        result.push({
            id: conflictCaseKey('pettyCash', item.id),
            label: 'Caja · ' + text(item.name || item.id),
            reason: 'Caja sin obra válida',
            kind: 'pettyCash'
        });
    }
    for (const item of array(model.diagnosticIssues)) {
        if (!item?.kind || item.key == null) continue;
        result.push({
            id: conflictCaseKey('diagnostic-' + item.kind, item.key),
            label: text(item.label || item.kind),
            reason: text(item.reason || 'Revisión especial'),
            kind: 'diagnostic',
            informational: item.informational === true
        });
    }
    return result;
}

export function applyProjectConflictArchive(model, archiveEntries = []) {
    if (!model?.enabled) return { ...model, pendingCases: [], archivedCases: [], archivedCount: 0 };
    const cases = collectProjectConflictCases(model);
    const saved = new Map(array(archiveEntries)
        .filter(item => item?.id && item?.status === 'archived')
        .map(item => [item.id, item]));
    // An issue whose condition has changed needs fresh review; don't hide it
    // merely because an old problem used the same record id.
    const archived = new Set(cases.filter(item =>
        saved.get(item.id)?.reason === item.reason).map(item => item.id));
    const visible = cases.filter(item => !archived.has(item.id));
    const archivedCases = cases.filter(item => archived.has(item.id)).map(item => ({
        ...item, archivedAt: saved.get(item.id).archivedAt, note: saved.get(item.id).note
    }));
    const remaining = {
        ...model,
        employeeRows: array(model.employeeRows).filter(item => !archived.has(conflictCaseKey('employee', item.id))),
        otherIssues: array(model.otherIssues).filter(item =>
            !item?.collection || !item?.recordKey || !archived.has(conflictCaseKey(item.collection, item.recordKey))),
        pettyCashRows: array(model.pettyCashRows).filter(item => !archived.has(conflictCaseKey('pettyCash', item.id))),
        orphanAttendanceKeys: array(model.orphanAttendanceKeys).filter(key =>
            !text(key) || !archived.has(conflictCaseKey('orphanAttendance', key))),
        diagnosticIssues: array(model.diagnosticIssues).filter(item =>
            !item?.kind || item.key == null || !archived.has(conflictCaseKey('diagnostic-' + item.kind, item.key))),
        pendingCases: visible,
        archivedCases,
        archivedCount: archivedCases.length
    };
    remaining.pendingEmployeeCount = remaining.employeeRows.length;
    remaining.totalPendingCount = remaining.employeeRows.length + remaining.otherIssues.length
        + remaining.pettyCashRows.length + remaining.diagnosticIssues.filter(item => !item.informational).length;
    // Historically orphan attendance is informational in the wizard
    // count; do not add it twice to the pending badge.
    remaining.issueCount = Math.max(0, (Number(model.issueCount) || 0) - archivedCases.length);
    return remaining;
}

export class ProjectConflictArchiveStore {
    constructor({ db = indexedDBService, getUid = () => auth?.currentUser?.uid } = {}) {
        this.db = db;
        this.getUid = getUid;
    }
    key() {
        const uid = text(this.getUid());
        if (!uid) throw new Error('Inicia sesión para archivar conflictos de manera segura.');
        return ARCHIVE_PREFIX + uid;
    }
    async list() {
        const key = this.key();
        const row = await this.db.get('settings', key);
        if (this.key() !== key) throw new Error('La cuenta cambió durante la lectura.');
        return array(row?.entries);
    }
    async setCase(item, { archived = true, note = '' } = {}) {
        const key = this.key();
        if (!item?.id || !item?.reason) throw new Error('Elige un conflicto válido.');
        const limitedNote = text(note).slice(0, 240);
        await this.db.atomicMutate('settings', key, current => {
            if (this.key() !== key) throw new Error('La cuenta cambió durante el archivo.');
            const entries = new Map(array(current?.entries).map(row => [row.id, row]));
            if (archived) {
                entries.set(item.id, {
                    id: text(item.id), status: 'archived', reason: text(item.reason),
                    archivedAt: Date.now(), note: limitedNote
                });
            } else {
                entries.delete(item.id);
            }
            return { write: true, value: {
                key, schemaVersion: 1, updatedAt: Date.now(), entries: [...entries.values()]
            } };
        });
        if (this.key() !== key) throw new Error('La cuenta cambió durante el archivo.');
        return true;
    }
}

export const projectConflictArchiveStore = new ProjectConflictArchiveStore();
