import indexedDBService from '../../services/IndexedDBService.js';
import { projectStore } from './ProjectStore.js';
import { protectedProjectIds, readProjectUsageData } from './ProjectUsage.js';

const copy = value => JSON.parse(JSON.stringify(value));
const rows = value => Array.isArray(value) ? value : Object.values(value || {});
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

/** Snapshot durable e independiente: no escribe preferencias ni AppState. */
export class ProjectReadOnlyContext {
    constructor({ store = projectStore, idb = indexedDBService, defaultId = () => protectedProjectIds().defaultProjectId } = {}) {
        this.store = store;
        this.idb = idb;
        this.defaultId = defaultId;
    }

    async open(projectId) {
        const project = await this.store.get(projectId);
        if (!project || project.deletedAt != null) throw new Error('La obra ya no está disponible.');
        const data = await readProjectUsageData({ idb: this.idb });
        const defaultId = this.defaultId();
        const owned = row => (row.projectId ?? defaultId) === projectId;
        const employees = rows(data.employees).filter(owned);
        const employeeIds = new Set(employees.map(e => e.id));
        const cash = rows(data.pettyCashProjects).filter(row => row.officialProjectId === projectId);
        const cashIds = new Set(cash.map(row => row.id));
        const attendance = rows(data.attendance).flatMap(row => {
            // Versiones anteriores guardaban un mapa por fecha.
            if (row.employeeId) return [row];
            return rows(row.records || row.attendance).filter(item => item && typeof item === 'object');
        }).filter(row => row.projectId != null ? owned(row) : employeeIds.has(row.employeeId));
        return freeze(copy({ project, readOnly: true, capturedAt: Date.now(), sections: {
            employees,
            positions: rows(data.positions).filter(owned),
            leaders: rows(data.leaders).filter(owned),
            attendance,
            loans: employees.flatMap(employee => rows(employee.loans).filter(loan => loan.projectId == null || owned(loan)).map(loan => ({ ...loan, employeeId: employee.id }))),
            payrollClosures: rows(data.payrollClosures).filter(owned),
            pettyCashProjects: cash,
            pettyCashPeriods: rows(data.pettyCashPeriods).filter(row => cashIds.has(row.projectId)),
            pettyCashMovements: rows(data.pettyCashMovements).filter(row => cashIds.has(row.projectId))
        } }));
    }
}
