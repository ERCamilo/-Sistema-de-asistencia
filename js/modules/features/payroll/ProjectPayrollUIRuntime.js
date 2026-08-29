import { capturePayrollProjectContext } from './PayrollProjectContext.js';
import * as projectPayrollConfigStore from './ProjectPayrollConfigStore.js';
import {
    createDefaultConfig,
    normalizeProjectPayrollConfig,
    validateProjectPayrollConfig
} from './ProjectPayrollConfig.js';
import { projectContext } from '../projects/ProjectContext.js';
import { clearPayrollAdjustmentPeriodRuntime } from './PayrollAdjustmentPeriodSelection.js';
import { calculateEmployeePayrollWithContext } from './PayrollService.js';
import {
    getPayrollEmployeesForPeriodWithContext,
    resolvePayrollPeriod
} from './PayrollPeriod.js';

export const PROJECT_PAYROLL_UI_CONFIG_FIELDS = Object.freeze([
    'regularHoursPerDay',
    'overtimeFactor',
    'holidayFactor',
    'holidays',
    'payPeriod',
    'defaultDeductionPercentage'
]);

const TRANSIENT_EXPORT_CONFIG_FIELDS = Object.freeze([
    'periodStart',
    'periodEnd',
    'activePreset',
    'periodSource',
    'payrollPreviewInclusion',
    'payrollLoanSelection',
    'payrollLoanExpandedEmployees',
    'payrollAdjustmentPeriodSelections',
    'payrollAdjustmentComposerScopes'
]);

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function configPayload(config, projectId) {
    const source = config && typeof config === 'object' ? config : {};
    return {
        projectId,
        regularHoursPerDay: source.regularHoursPerDay,
        overtimeFactor: source.overtimeFactor,
        holidayFactor: source.holidayFactor,
        holidays: source.holidays,
        payPeriod: source.payPeriod,
        defaultDeductionPercentage: source.defaultDeductionPercentage,
        payrollDefaults: source.payrollDefaults,
        schemaVersion: source.schemaVersion,
        updatedAt: source.updatedAt
    };
}

function createSession(projectId, generation) {
    return {
        key: `${projectId}:${generation}`,
        projectId,
        generation,
        selectedPeriod: null,
        preset: null,
        source: null,
        previewRows: [],
        previewKey: null,
        temporaryInclusion: {},
        temporarySelection: [],
        adjustmentSelections: {},
        status: 'idle',
        config: null,
        settingsView: null,
        error: null
    };
}

export function createProjectPayrollSettingsView(legacySettings, config) {
    const view = { ...(legacySettings || {}) };
    for (const field of PROJECT_PAYROLL_UI_CONFIG_FIELDS) view[field] = clone(config?.[field]);
    return view;
}

export class PayrollConfigUnavailableError extends Error {
    constructor(projectId, options = {}) {
        super(`Payroll config unavailable for project "${projectId}"`, options);
        this.name = 'PayrollConfigUnavailableError';
        this.code = 'PAYROLL_CONFIG_UNAVAILABLE';
        this.projectId = projectId;
        this.canInitialize = true;
    }
}

export class ProjectPayrollUIRuntime {
    constructor({
        state,
        configStore = projectPayrollConfigStore,
        projectContext: projectChanges = projectContext,
        captureContext = capturePayrollProjectContext
    } = {}) {
        this.state = state || {};
        this.configStore = configStore;
        this.captureContext = captureContext;
        this.generation = 0;
        this.activeProjectId = null;
        this.sessions = new Map();
        this.invalidationListeners = new Set();
        this.unsubscribe = typeof projectChanges?.subscribe === 'function'
            ? projectChanges.subscribe(change => this.handleProjectChange(change))
            : () => {};
    }

    handleProjectChange({ projectId } = {}) {
        this.generation += 1;
        this.activeProjectId = projectId ? String(projectId) : null;
        this.sessions.clear();
        clearPayrollAdjustmentPeriodRuntime();
        const exportConfig = this.state?.exportConfig;
        if (exportConfig && typeof exportConfig === 'object') {
            for (const field of TRANSIENT_EXPORT_CONFIG_FIELDS) delete exportConfig[field];
        }
        for (const listener of [...this.invalidationListeners]) listener({ projectId: this.activeProjectId });
    }

    beginRequest() {
        const ctx = this.captureContext(this.state);
        if (!ctx.isScoped) {
            return { enabled: false, projectId: null, generation: this.generation, ctx, session: null };
        }
        const projectId = String(ctx.projectId);
        if (this.activeProjectId == null) this.activeProjectId = projectId;
        const key = `${projectId}:${this.generation}`;
        if (!this.sessions.has(key)) this.sessions.set(key, createSession(projectId, this.generation));
        return {
            enabled: true,
            projectId,
            generation: this.generation,
            ctx,
            session: this.sessions.get(key)
        };
    }

    isCurrent(request) {
        if (!request?.enabled) return request?.generation === this.generation;
        return request.generation === this.generation && request.projectId === this.activeProjectId;
    }

    commitIfCurrent(request, commit) {
        if (!this.isCurrent(request)) return false;
        return commit(request);
    }

    subscribeInvalidation(listener) {
        this.invalidationListeners.add(listener);
        return () => this.invalidationListeners.delete(listener);
    }

    getCurrentView() {
        const request = this.beginRequest();
        if (!request.enabled) {
            return { enabled: false, status: 'legacy', settingsView: this.state.settings, request };
        }
        return {
            enabled: true,
            projectId: request.projectId,
            status: request.session.status,
            config: request.session.config,
            settingsView: request.session.settingsView,
            error: request.session.error,
            period: request.session.selectedPeriod,
            previewRows: request.session.previewRows,
            request
        };
    }

    async loadConfig(request = this.beginRequest()) {
        if (!request.enabled) {
            return { enabled: false, projectId: null, config: this.state.settings, request, session: null };
        }
        let config;
        try {
            config = await this.configStore.getConfig(request.projectId);
        } catch (cause) {
            throw new PayrollConfigUnavailableError(request.projectId, { cause });
        }
        if (!config) throw new PayrollConfigUnavailableError(request.projectId);
        return {
            enabled: true,
            projectId: request.projectId,
            config,
            settingsView: createProjectPayrollSettingsView(this.state.settings, config),
            request,
            session: request.session
        };
    }

    async ensureCurrentConfig(request = this.beginRequest()) {
        if (!request.enabled) return this.loadConfig(request);
        if (request.session.config && request.session.status === 'ready') {
            return {
                enabled: true,
                projectId: request.projectId,
                config: request.session.config,
                settingsView: request.session.settingsView,
                request,
                session: request.session
            };
        }
        request.session.status = 'loading';
        request.session.error = null;
        try {
            const loaded = await this.loadConfig(request);
            this.commitIfCurrent(request, () => {
                request.session.config = loaded.config;
                request.session.settingsView = loaded.settingsView;
                request.session.status = 'ready';
            });
            return loaded;
        } catch (error) {
            this.commitIfCurrent(request, () => {
                request.session.status = 'unavailable';
                request.session.error = error;
            });
            throw error;
        }
    }

    async saveConfig(config, request = this.beginRequest()) {
        if (!request.enabled) {
            return { enabled: false, projectId: null, config: this.state.settings, request, session: null };
        }
        const normalized = normalizeProjectPayrollConfig(configPayload(config, request.projectId));
        validateProjectPayrollConfig(normalized);
        const persisted = await this.configStore.putConfig(normalized);
        this.commitIfCurrent(request, () => {
            request.session.config = persisted;
            request.session.settingsView = createProjectPayrollSettingsView(this.state.settings, persisted);
            request.session.status = 'ready';
            request.session.error = null;
            request.session.previewRows = [];
            request.session.previewKey = null;
        });
        return {
            enabled: true,
            projectId: request.projectId,
            config: persisted,
            request,
            session: request.session
        };
    }

    async updateConfig(updater) {
        const request = this.beginRequest();
        if (!request.enabled) return this.saveConfig(this.state.settings, request);
        const loaded = await this.ensureCurrentConfig(request);
        const next = typeof updater === 'function'
            ? updater(clone(loaded.config))
            : { ...loaded.config, ...(updater || {}) };
        return this.saveConfig(next, request);
    }

    async generatePreview({ periodStart, periodEnd, today = new Date() } = {}) {
        const request = this.beginRequest();
        if (!request.enabled) throw new Error('Scoped payroll preview requires projects enabled');
        const loaded = await this.ensureCurrentConfig(request);
        const configuredPeriod = resolvePayrollPeriod(loaded.config.payPeriod, today);
        const previous = request.session.selectedPeriod;
        const period = periodStart && periodEnd
            ? { periodStart, periodEnd, source: 'custom' }
            : previous?.periodStart && previous?.periodEnd
                ? previous
                : configuredPeriod;
        const baseContext = loaded.request.ctx;
        const previewContext = {
            ...baseContext,
            employees: Object.freeze(baseContext.employees.map(employee => Object.freeze({
                ...employee,
                bonuses: [],
                deductions: []
            })))
        };
        const employees = getPayrollEmployeesForPeriodWithContext(
            previewContext,
            period.periodStart,
            period.periodEnd
        );
        const rows = employees.map(employee => {
            const payroll = calculateEmployeePayrollWithContext(
                previewContext,
                loaded.config,
                employee.id,
                period.periodStart,
                period.periodEnd,
                [],
                [],
                [],
                []
            );
            return {
                id: Number.parseInt(employee.number, 10) || 0,
                nombre: `${employee.name} (Ref #${employee.number})`,
                monto: payroll.neto,
                _brutoOriginal: payroll.brutoOriginal,
                _employeeId: employee.id,
                _employeeName: employee.name,
                _number: employee.number,
                _positionBreakdown: payroll.breakdown || [],
                _projectId: request.projectId
            };
        }).sort((left, right) => String(left._number).localeCompare(String(right._number), 'es', { numeric: true }));
        const current = this.isCurrent(request);
        this.commitIfCurrent(request, () => {
            request.session.selectedPeriod = period;
            request.session.preset = period.source === 'configured' ? 'payPeriod' : null;
            request.session.source = period.source;
            request.session.previewRows = rows;
            request.session.previewKey = `${request.session.key}:${period.periodStart}:${period.periodEnd}`;
        });
        return {
            projectId: request.projectId,
            config: loaded.config,
            period,
            rows,
            current,
            request,
            sessionKey: request.session.key
        };
    }

    async initializeConfig() {
        const request = this.beginRequest();
        if (!request.enabled) {
            return { enabled: false, projectId: null, config: this.state.settings, request, session: null };
        }
        const neutral = createDefaultConfig(request.projectId);
        validateProjectPayrollConfig(neutral);
        const persisted = await this.configStore.putConfig(neutral);
        return {
            enabled: true,
            projectId: request.projectId,
            config: persisted,
            request,
            session: request.session
        };
    }

    dispose() {
        this.unsubscribe();
        this.sessions.clear();
        this.invalidationListeners.clear();
    }
}

export default ProjectPayrollUIRuntime;
