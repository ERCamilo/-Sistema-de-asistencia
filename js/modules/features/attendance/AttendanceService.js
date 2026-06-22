import icons from '../../ui/IconSystem.js';
import { getDateKey, isDayHoliday } from '../../utils/DateUtils.js';
import { getDeviceId } from '../../config/Config.js';
import { invalidateEmployeeStats, buildAttendanceIndex } from '../../core/AppState.js';

export class AttendanceService {
    constructor(state) {
        this.state = state;
    }

    /**
     * Fase 4: mantiene la coherencia derivada (cache MTD + índice por día) de forma
     * EXPLÍCITA, sin depender del trap del proxy ni del modo silencioso (batchSetState).
     * Usa el employeeId REAL recibido — evita el bug de truncado por guion del proxy.
     */
    _maintainCoherence(employeeId, dateKey) {
        invalidateEmployeeStats(employeeId);
        buildAttendanceIndex(dateKey);
    }

    // Crear registro de asistencia
    createRecord(employeeId, date, options = {}) {
        const emp = this.state.employees.find(e => e.id === employeeId);
        if (!emp) {
            if (window.debug) window.debug.error(`${icons.get('info')} Empleado no encontrado:`, employeeId);
            return null;
        }

        const dateKey = getDateKey(date);
        const key = `${employeeId}-${dateKey}`;

        const record = {
            employeeId,
            date: dateKey,
            present: true,
            hoursWorked: options.hoursWorked || this.state.settings.regularHoursPerDay,
            overtimeHours: options.overtimeHours || 0,
            isHoliday: options.isHoliday !== undefined ? options.isHoliday : isDayHoliday(date, this.state.settings?.holidays || []),
            selectedPosition: options.selectedPosition || emp.positions[0] || null,
            multiPosition: options.multiPosition || false,
            positionHours: options.positionHours || [],
            notes: options.notes || '',
            createdAt: new Date().toISOString(),
            updatedAt: Date.now(),
            lastAccessed: Date.now(),
            deviceId: getDeviceId()
        };

        this.state.attendance[key] = record;
        this._maintainCoherence(employeeId, dateKey);
        return record;
    }

    // Actualizar registro
    updateRecord(employeeId, date, updates) {
        const dateKey = getDateKey(date);
        const key = `${employeeId}-${dateKey}`;
        const record = this.state.attendance[key];

        if (!record) {
            if (window.debug) window.debug.error(`${icons.get('info')} Registro no encontrado:`, key);
            return null;
        }

        Object.assign(record, updates, {
            updatedAt: Date.now(),
            lastAccessed: Date.now(),
            deviceId: getDeviceId()
        });

        this._maintainCoherence(employeeId, dateKey);
        return record;
    }

    /**
     * 👆 Marcar un registro como "recientemente usado"
     */
    touchRecord(employeeId, dateKey) {
        const key = `${employeeId}-${dateKey}`;
        if (this.state.attendance[key]) {
            this.state.attendance[key].lastAccessed = Date.now();
        }
    }

    // Eliminar registro
    deleteRecord(employeeId, date) {
        const dateKey = getDateKey(date);
        const key = `${employeeId}-${dateKey}`;

        if (this.state.attendance[key]) {
            delete this.state.attendance[key];
            this._maintainCoherence(employeeId, dateKey);
            if (window.debug) window.debug.log(`${icons.get('info')} Registro eliminado:`, key);
            return true;
        }
        return false;
    }

    // Obtener registros de un empleado
    getEmployeeRecords(employeeId, startDate, endDate) {
        const records = [];

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const key = `${employeeId}-${getDateKey(d)}`;
            const record = this.state.attendance[key];
            if (record && record.present) {
                records.push(record);
            }
        }

        return records;
    }

    // Calcular estadísticas de empleado
    getEmployeeStats(employeeId, startDate, endDate) {
        const records = this.getEmployeeRecords(employeeId, startDate, endDate);

        const stats = {
            totalDays: records.length,
            totalHours: 0,
            totalOvertime: 0,
            holidayDays: 0,
            regularDays: 0
        };

        records.forEach(record => {
            stats.totalHours += record.hoursWorked || 0;
            stats.totalOvertime += record.overtimeHours || 0;
            if (record.isHoliday) {
                stats.holidayDays++;
            } else {
                stats.regularDays++;
            }
        });

        return stats;
    }

    // Validar registro
    validateRecord(record) {
        const errors = [];

        if (!record.employeeId) {
            errors.push('ID de empleado requerido');
        }

        if (!record.date) {
            errors.push('Fecha requerida');
        }

        if (record.hoursWorked < 0 || record.hoursWorked > 24) {
            errors.push('Horas trabajadas inválidas (0-24)');
        }

        if (record.overtimeHours < 0 || record.overtimeHours > 12) {
            errors.push('Horas extra inválidas (0-12)');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}
