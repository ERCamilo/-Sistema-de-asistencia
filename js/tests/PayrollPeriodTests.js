import { getPayrollEmployeesForPeriod, resolvePayrollPeriod } from '../modules/features/payroll/PayrollPeriod.js';

testRunner.addSuite('PayrollPeriod — período y elegibilidad', {
    'resuelve el período configurado de forma inclusiva'() {
        const result = resolvePayrollPeriod({ periodStart: '2026-07-10', periodLength: 15 }, new Date(2026, 6, 20));
        testRunner.assertEquals(result.periodEnd, '2026-07-24', 'La duración incluye el primer día');
        testRunner.assertEquals(result.source, 'configured', 'Debe conservar la configuración válida');
    },

    'usa desde el primer día del mes hasta hoy si la configuración es inválida'() {
        const result = resolvePayrollPeriod({ periodStart: 'mal', periodLength: 0 }, new Date(2026, 6, 20));
        testRunner.assertEquals(result.periodStart, '2026-07-01', 'Inicio mensual');
        testRunner.assertEquals(result.periodEnd, '2026-07-20', 'Fin en hoy');
    },

    'excluye empleados inactivos aunque tengan asistencia presente dentro del rango'() {
        const employees = [
            { id: 1, number: 1, active: true },
            { id: 2, number: 2, active: false },
            { id: 3, number: 3, active: false },
            { id: 4, number: 4, active: false }
        ];
        const state = {
            employees, positions: [], exportConfig: { leaderFilter: 'all' },
            attendance: {
                '2-2026-07-10': { present: true },
                '3-2026-07-10': { present: true, deletedAt: '2026-07-11' },
                '4-2026-06-30': { present: true }
            }
        };
        const result = getPayrollEmployeesForPeriod(state, '2026-07-01', '2026-07-15');
        testRunner.assertEquals(JSON.stringify(result.map(item => item.id)), JSON.stringify([1]), 'Nómina solo debe incluir empleados activos');
    },

    'incluye un empleado inactivo cuando una regla individual vigente lo selecciona'() {
        const state = {
            employees: [
                { id: 1, number: 1, active: true },
                { id: 2, number: 2, active: false },
                { id: 3, number: 3, active: false }
            ],
            positions: [],
            attendance: {},
            exportConfig: {
                leaderFilter: 'all',
                bonuses: [{
                    id: 'BON-1',
                    scope: 'employee',
                    targetIds: ['2'],
                    type: 'fixed',
                    value: 2000
                }],
                deductions: []
            }
        };

        const result = getPayrollEmployeesForPeriod(state, '2026-07-01', '2026-07-15');

        testRunner.assertEquals(
            JSON.stringify(result.map(item => item.id)),
            JSON.stringify([1, 2]),
            'Debe incluir únicamente al inactivo seleccionado por la regla'
        );
    },

    'aplica el filtro de líder al inactivo seleccionado por una deducción'() {
        const state = {
            employees: [
                { id: 2, number: 2, active: false, position: 10 },
                { id: 3, number: 3, active: false, position: 99 }
            ],
            positions: [{ id: '10', leaderId: 7 }],
            attendance: {},
            exportConfig: {
                leaderFilter: '7',
                bonuses: [],
                deductions: [{
                    id: 'DED-1',
                    scope: 'employee',
                    employeeIds: ['2', '3'],
                    type: 'fixed',
                    value: 500
                }]
            }
        };

        const result = getPayrollEmployeesForPeriod(state, '2026-07-01', '2026-07-15');

        testRunner.assertEquals(
            JSON.stringify(result.map(item => item.id)),
            JSON.stringify([2]),
            'El inactivo ajustado todavía debe respetar el líder seleccionado'
        );
    },

    'acepta líder por posición actual o histórica normalizando ids'() {
        const state = {
            employees: [
                { id: 1, number: 1, active: true, position: 10 },
                { id: 2, number: 2, active: false },
                { id: 3, number: 3, active: true, position: 99 },
                { id: 4, number: 4, active: true, position: 99 }
            ],
            positions: [{ id: '10', leaderId: 7 }],
            exportConfig: { leaderFilter: '7' },
            attendance: {
                '2-2026-07-05': { present: true, selectedPosition: 10 },
                '4-2026-07-05': { present: true, selectedPosition: 10 }
            }
        };
        const result = getPayrollEmployeesForPeriod(state, '2026-07-01', '2026-07-15');
        testRunner.assertEquals(JSON.stringify(result.map(item => item.id)), JSON.stringify([1, 4]), 'Posición actual e histórica deben coincidir solo para empleados activos');
    }
});
