import { getDateKey } from '../../utils/DateUtils.js';
import { getActivePayrollSettings } from '../payroll/ActivePayrollSettings.js';
import { resolvePayrollPeriod } from '../payroll/PayrollPeriod.js';
import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { peekEntityScope, entityInScope } from '../projects/ProjectContext.js';
import { normalizeRegularHoursPerDay } from '../../utils/AttendanceHours.js';
import { toStoredHourly } from '../payroll/SalaryConversion.js';
import { Modal } from '../../components/Modal.js';

export function employeeEditorData(state, employee) {
    // Photo hydration updates its own controls; these synchronization fields
    // do not change the form and must not discard an unsaved draft.
    const editorEmployee = employee ? { ...employee } : null;
    if (editorEmployee) {
        delete editorEmployee.photo;
        delete editorEmployee.updatedAt;
        delete editorEmployee._isDirty;
    }
    const activeSettings = getActivePayrollSettings(state);
    const today = new Date();
    const period = resolvePayrollPeriod(activeSettings.payPeriod, today);
    const attendance = [];
    // The editor calculates this employee's current payroll period only.
    // Use keyed reads instead of scanning the entire attendance history.
    if (employee && !isProjectsEnabled()) {
        const end = new Date(`${period.periodEnd}T12:00:00`);
        for (const date = new Date(`${period.periodStart}T12:00:00`); date <= end; date.setDate(date.getDate() + 1)) {
            const key = `${employee.id}-${getDateKey(date)}`;
            if (state.attendance?.[key]) attendance.push([key, state.attendance[key]]);
        }
    }
    const payrollSettings = value => ({
        voiceMvpEnabled: value?.voiceMvpEnabled,
        regularHoursPerDay: value?.regularHoursPerDay,
        overtimeFactor: value?.overtimeFactor,
        holidayFactor: value?.holidayFactor,
        restDayFactor: value?.restDayFactor,
        holidays: value?.holidays,
        payPeriod: value?.payPeriod
    });
    return JSON.stringify({
        employee: editorEmployee,
        positions: state.positions,
        leaders: state.leaders,
        attendance,
        settings: payrollSettings(state.settings),
        activeSettings: payrollSettings(activeSettings),
        scope: peekEntityScope(),
        projectsEnabled: isProjectsEnabled(),
        today: getDateKey(today)
    });
}

const scalarFields = {
    number: ['empNumber', 'Número'], name: ['empName', 'Nombre'],
    hireDate: ['empHireDate', 'Fecha de contratación'], phone: ['empPhone', 'Teléfono'],
    email: ['empEmail', 'Correo'], notes: ['empNotes', 'Notas']
};
// Sort object keys so snapshots replaced by synchronization compare by value.
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, stable(value[key])])
    );
    return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export function readEmployeeForm(root, regularHours) {
    const fields = Object.fromEntries(Object.entries(scalarFields).map(([field, [id]]) =>
        [field, root.querySelector(`#${id}`).value.trim()]
    ));
    fields.positions = [...root.querySelectorAll('input[name="empPosition"]:checked')].map(input => input.value);
    fields.positionSalaries = {};
    fields.positionSalaryModes = {};
    const modes = new Map([...root.querySelectorAll('.custom-salary-mode')].map(select => [select.dataset.posId, select.value]));
    root.querySelectorAll('.custom-salary-input').forEach(input => {
        const posId = input.dataset.posId;
        const mode = modes.get(posId) === 'daily' ? 'daily' : 'hourly';
        if (mode === 'daily') fields.positionSalaryModes[posId] = 'daily';
        if (input.closest('[data-position-assignment]')?.dataset.salarySource !== 'default') {
            const rate = Number(input.value);
            if (rate > 0 && Number.isFinite(rate)) fields.positionSalaries[posId] = toStoredHourly(rate, mode, regularHours);
        }
    });
    return fields;
}

function positionsOf(fields) {
    return {
        positions: [...(fields.positions || [])].sort(),
        positionSalaries: fields.positionSalaries || {},
        positionSalaryModes: fields.positionSalaryModes || {}
    };
}

export class EmployeeEditorDraft {
    constructor({ root, employee, state, regularHours, readState, reload }) {
        this.root = root;
        this.employeeId = employee?.id || employee?.key || null;
        this.employeeKey = employee?.key || this.employeeId;
        this.regularHours = regularHours;
        this.scope = peekEntityScope();
        this.readState = readState;
        this.initialForm = readEmployeeForm(root, regularHours);
        this.initialFormVersion = this.formVersion();
        this.initialEmployee = employee ? JSON.parse(JSON.stringify(employee)) : null;
        this.initialData = employeeEditorData(state, employee);
        const notice = document.createElement('div');
        notice.className = 'employee-draft-notice';
        notice.dataset.employeeDraftNotice = '';
        notice.hidden = true;
        const message = document.createElement('p');
        message.setAttribute('role', 'status');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Recargar datos';
        button.addEventListener('click', async () => {
            if (this.reloading) return;
            this.reloading = true;
            const discard = !this.isDirty() || await Modal.confirm({
                title: '¿Descartar el borrador?',
                message: 'Recargar reemplazará tus cambios sin guardar por los datos más recientes.',
                confirmText: 'Descartar y recargar', cancelText: 'Seguir editando'
            });
            this.reloading = false;
            if (discard && root.isConnected && this.inScope()) reload();
        });
        notice.append(message, button);
        root.querySelector('#employee-modal-form').prepend(notice);
        this.notice = notice;
        this.message = message;
        this.reloadButton = button;
    }

    currentEmployee(state = this.readState()) {
        return state.employees.find(employee => employee.id === this.employeeId || employee.key === this.employeeId);
    }

    inScope() { return equal(this.scope, peekEntityScope()); }

    isDirty() { return this.initialFormVersion !== this.formVersion(); }

    refresh() {
        const state = this.readState();
        const employee = this.currentEmployee(state);
        const scopeChanged = !this.inScope() || (employee && !entityInScope(employee, this.scope));
        const removed = this.employeeId && (!employee || employee.mergedIntoId || employee.deletedAt);
        const changed = scopeChanged || removed || employeeEditorData(state, employee || null) !== this.initialData;
        this.notice.hidden = !changed;
        this.reloadButton.disabled = !!(scopeChanged || removed);
        if (!changed) return;
        const text = scopeChanged
            ? 'Cambió el proyecto activo. Cierra este formulario y abre el empleado desde su proyecto para guardar.'
            : removed
                ? 'Este empleado fue eliminado o fusionado. Tu borrador sigue visible, pero no se puede guardar.'
                : 'Hay datos actualizados. Tu borrador se conserva; las cifras y tarifas mostradas corresponden a los datos con los que abriste el formulario.';
        if (this.message.textContent !== text) this.message.textContent = text;
    }

    prepareSave(state = this.readState()) {
        const employee = this.currentEmployee(state);
        if (!this.inScope() || (employee && !entityInScope(employee, this.scope))) {
            return { error: 'Cambió el proyecto activo. Abre el empleado desde su proyecto antes de guardar.' };
        }
        if (this.employeeId && (!employee || employee.deletedAt || employee.mergedIntoId)) {
            return { error: 'El empleado fue eliminado o fusionado. No se guardaron cambios.' };
        }
        const form = readEmployeeForm(this.root, this.regularHours);
        const positionsEdited = !employee || !equal(positionsOf(form), positionsOf(this.initialForm));
        if (positionsEdited && form.positions.some(id => !state.positions.some(position => String(position.id) === String(id)
            && entityInScope(position, this.scope)))) {
            return { error: 'Un puesto de tu borrador ya no está disponible. Recarga los datos antes de guardar.' };
        }
        if (!employee) return {
            fields: form, conflicts: this.dailyHoursConflicts(form, state),
            version: this.version(state), formVersion: this.formVersion()
        };
        const fields = { ...form };
        const conflicts = [];
        for (const [field, [, label]] of Object.entries(scalarFields)) {
            const original = String(this.initialEmployee[field] ?? (field === 'hireDate' ? this.initialForm[field] : ''));
            const latest = String(employee[field] ?? (field === 'hireDate' ? this.initialForm[field] : ''));
            if (form[field] === this.initialForm[field]) fields[field] = latest;
            else if (latest !== original && latest !== form[field]) conflicts.push(label);
        }
        if (equal(positionsOf(form), positionsOf(this.initialForm))) {
            fields.positions = [...(employee.positions || [])];
            fields.positionSalaries = { ...(employee.positionSalaries || {}) };
            fields.positionSalaryModes = { ...(employee.positionSalaryModes || {}) };
        } else {
            if (!equal(positionsOf(employee), positionsOf(this.initialEmployee))
                && !equal(positionsOf(employee), positionsOf(form))) conflicts.push('Puestos y tarifas');
            conflicts.push(...this.dailyHoursConflicts(form, state));
        }
        return { fields, conflicts, version: this.version(state), formVersion: this.formVersion() };
    }

    dailyHoursConflicts(form, state) {
        const hours = normalizeRegularHoursPerDay(getActivePayrollSettings(state).regularHoursPerDay);
        return hours !== this.regularHours && Object.keys(form.positionSalaries)
            .some(id => form.positionSalaryModes[id] === 'daily')
            ? [`Jornada: las tarifas por día se convertirán usando ${this.regularHours} horas, como al abrir el formulario`]
            : [];
    }

    formVersion() {
        // Keep incomplete input and custom/default intent, even when the
        // normalized values happen to match the values originally loaded.
        return JSON.stringify({
            fields: Object.values(scalarFields).map(([id]) => this.root.querySelector(`#${id}`).value),
            positions: [...this.root.querySelectorAll('[data-position-assignment]')].map(card => ({
                id: card.dataset.positionAssignment,
                checked: card.querySelector('input[name="empPosition"]')?.checked,
                rate: card.querySelector('.custom-salary-input')?.value,
                mode: card.querySelector('.custom-salary-mode')?.value,
                source: card.dataset.salarySource
            }))
        });
    }

    isCurrent(plan) { return this.inScope() && this.version() === plan.version && this.formVersion() === plan.formVersion; }

    version(state = this.readState()) {
        return employeeEditorData(state, this.currentEmployee(state) || null);
    }
}
