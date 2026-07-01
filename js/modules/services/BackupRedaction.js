/**
 * 🔒 BackupRedaction.js (R-gaps: datos sensibles en claro en sessionStorage)
 *
 * El auto-backup de sessionStorage ('attendance-backup') es una red de
 * emergencia que se restaura sólo si IndexedDB queda vacío al arrancar. Guardaba
 * el estado COMPLETO en claro (salarios, préstamos, adelantos, teléfonos),
 * legible desde la consola por el siguiente usuario en un equipo compartido.
 *
 * redactSensitiveBackup quita esos campos del payload del AUTO-backup, dejando
 * lo necesario para recuperar la forma de la UI (ids, nombres, asignaciones,
 * asistencia). Los datos financieros/PII se rehidratan desde IndexedDB / la nube.
 *
 * ⚠️ Esto es SÓLO para el auto-backup de sessionStorage. El export a archivo JSON
 * (window.exportData) es una descarga deliberada del usuario y NO se redacta.
 */

// Campos financieros/PII a quitar de cada empleado.
// JD#3: incluidos bonuses/deductions (montos) y email (PII), antes omitidos.
// JD2#5: positionSalaryModes revela el esquema salarial por puesto.
export const EMPLOYEE_SENSITIVE_FIELDS = [
    'salary', 'dailyRate', 'customSalary', 'positionSalaries', 'positionSalaryModes',
    'loans', 'advances', 'bonuses', 'deductions',
    'phone', 'email', 'rnc', 'cedula'
];

// Campos salariales a quitar de cada puesto.
// JD#3: hourlyRate es la TARIFA REAL almacenada (baseSalary es solo alias
// derivado); salaryInputMode revela el esquema salarial. Antes omitidos.
export const POSITION_SENSITIVE_FIELDS = [
    'salary', 'salario', 'salaryConfig', 'baseSalary', 'dailyRate',
    'hourlyRate', 'salaryInputMode'
];

// JD2#2: los líderes también llevan PII de contacto (phone/email) que quedaba
// en claro en el auto-backup de sessionStorage.
export const LEADER_SENSITIVE_FIELDS = ['phone', 'email'];

function stripFields(item, fields) {
    if (!item || typeof item !== 'object') return item;
    const clone = { ...item };
    for (const f of fields) {
        if (f in clone) delete clone[f];
    }
    return clone;
}

function redactArray(arr, fields) {
    return Array.isArray(arr) ? arr.map(item => stripFields(item, fields)) : arr;
}

/**
 * Devuelve una COPIA del payload del backup con los campos financieros/PII
 * quitados de employees y positions. No muta el input. Defensivo ante
 * datos vacíos/ausentes.
 *
 * @param {Object} data - { employees, positions, leaders, attendance, settings }
 * @returns {Object}
 */
export function redactSensitiveBackup(data) {
    if (!data || typeof data !== 'object') return data;
    return {
        ...data,
        employees: redactArray(data.employees, EMPLOYEE_SENSITIVE_FIELDS),
        positions: redactArray(data.positions, POSITION_SENSITIVE_FIELDS),
        leaders: redactArray(data.leaders, LEADER_SENSITIVE_FIELDS)
    };
}
