import { resolveRestDayFactor } from '../modules/features/payroll/PayrollFactors.js';
import { PayrollService } from '../modules/features/payroll/PayrollService.js';
import { buildEmployeeReportData } from '../modules/features/analytics/EmployeeReportData.js';

describe('RestDayFactor Resolution & Payroll Integration', () => {
    describe('resolveRestDayFactor hierarchy (Leader > Position > Global)', () => {
        // Decisión del usuario (2026-11-10): el día libre se paga con lo que paga el líder.
        test('Leader wins over Position and Global', () => {
            const position = { restDayFactor: 2.0 };
            const leader = { restDayFactor: 1.75 };
            const settings = { restDayFactor: 1.5 };

            expect(resolveRestDayFactor(position, leader, settings)).toBe(1.75);
        });

        test('Position applies only when the Leader defines none', () => {
            expect(resolveRestDayFactor({ restDayFactor: 2.0 }, { restDayFactor: null }, { restDayFactor: 1.5 })).toBe(2.0);
            expect(resolveRestDayFactor({ restDayFactor: 2.0 }, null, { restDayFactor: 1.5 })).toBe(2.0);
        });

        test('Leader override wins over Global when Position has no factor', () => {
            const position = { restDayFactor: null };
            const leader = { restDayFactor: 1.75 };
            const settings = { restDayFactor: 1.5 };

            expect(resolveRestDayFactor(position, leader, settings)).toBe(1.75);
        });

        test('Global factor is used when Position and Leader have no factor', () => {
            const position = { restDayFactor: null };
            const leader = { restDayFactor: null };
            const settings = { restDayFactor: 1.8 };

            expect(resolveRestDayFactor(position, leader, settings)).toBe(1.8);
        });

        test('Default 1.5 is used when all are empty or null', () => {
            expect(resolveRestDayFactor(null, null, null)).toBe(1.5);
            expect(resolveRestDayFactor({}, {}, {})).toBe(1.5);
        });
    });

    describe('PayrollService integration with restDayHours', () => {
        test('calculates restDayHours and applies restDayFactor when working on a day off', () => {
            const state = {
                settings: {
                    regularHoursPerDay: 8,
                    overtimeFactor: 1.5,
                    holidayFactor: 2.0,
                    restDayFactor: 1.5,
                    holidays: []
                },
                positions: [
                    {
                        id: 'pos-1',
                        name: 'Albañil',
                        hourlyRate: 100,
                        workingDays: [1, 2, 3, 4, 5], // Lunes a Viernes (0=Dom, 6=Sáb son días libres)
                        leaderId: 'ldr-1',
                        restDayFactor: 2.0 // El puesto solo aplica si el líder no define el suyo
                    }
                ],
                leaders: [
                    { id: 'ldr-1', name: 'Carlos', restDayFactor: 1.75 }
                ],
                employees: [
                    {
                        id: 'emp-1',
                        name: 'Juan Perez',
                        positions: ['pos-1'],
                        positionSalaries: {}
                    }
                ],
                attendance: {
                    // 2026-08-23 es Domingo (day 0 -> Día Libre)
                    'emp-1-2026-08-23': {
                        present: true,
                        hoursWorked: 8,
                        selectedPosition: 'pos-1'
                    },
                    // 2026-08-24 es Lunes (day 1 -> Día Regular)
                    'emp-1-2026-08-24': {
                        present: true,
                        hoursWorked: 8,
                        selectedPosition: 'pos-1'
                    }
                }
            };

            const service = new PayrollService(state);
            const payroll = service.calculateEmployeePayroll('emp-1', '2026-08-23', '2026-08-24');

            expect(payroll.breakdown).toHaveLength(1);
            const b = payroll.breakdown[0];
            expect(b.regularHours).toBe(8);
            expect(b.restDayHours).toBe(8);
            expect(b.restDayFactor).toBe(1.75); // Manda el líder (Carlos)
            expect(b.restDayRate).toBe(175);    // 100 * 1.75
            expect(b.restDayAmount).toBe(1400); // 8h * 175
            expect(b.regularAmount).toBe(800);  // 8h * 100
            expect(payroll.bruto).toBe(2200);   // 1400 + 800
        });

        test('holiday takes precedence over rest day', () => {
            const state = {
                settings: {
                    regularHoursPerDay: 8,
                    overtimeFactor: 1.5,
                    holidayFactor: 2.5,
                    restDayFactor: 1.5,
                    holidays: ['2026-08-23'] // Domingo marcado como feriado
                },
                positions: [
                    {
                        id: 'pos-1',
                        name: 'Albañil',
                        hourlyRate: 100,
                        workingDays: [1, 2, 3, 4, 5],
                        leaderId: null,
                        restDayFactor: 2.0
                    }
                ],
                leaders: [],
                employees: [
                    {
                        id: 'emp-1',
                        name: 'Juan Perez',
                        positions: ['pos-1'],
                        positionSalaries: {}
                    }
                ],
                attendance: {
                    'emp-1-2026-08-23': {
                        present: true,
                        hoursWorked: 8,
                        selectedPosition: 'pos-1'
                    }
                }
            };

            const service = new PayrollService(state);
            const payroll = service.calculateEmployeePayroll('emp-1', '2026-08-23', '2026-08-23');

            const b = payroll.breakdown[0];
            expect(b.holidayHours).toBe(8);
            expect(b.restDayHours).toBe(0);
            expect(b.holidayRate).toBe(250); // 100 * 2.5
            expect(payroll.bruto).toBe(2000); // 8h * 250
        });
    });

    describe('EmployeeReportData weighted days computation', () => {
        test('computes dayValue = (hours/regularHours) * factor for rest day', () => {
            const employees = [{ id: 'emp-1', number: '001', name: 'Juan', positions: ['pos-1'] }];
            const positions = [{ id: 'pos-1', name: 'Albañil', workingDays: [1, 2, 3, 4, 5], active: true, restDayFactor: 1.5 }];
            const attendance = {
                // Domingo 2026-08-23 (Día Libre)
                'emp-1-2026-08-23': { present: true, hoursWorked: 8, selectedPosition: 'pos-1' }
            };
            const days = [{ date: new Date('2026-08-23T12:00:00'), isHoliday: false }];

            const report = buildEmployeeReportData({
                employees,
                positions,
                attendance,
                days,
                startDate: '2026-08-23',
                endDate: '2026-08-23',
                regularHours: 8,
                holidayFactor: 2,
                restDayFactor: 1.5
            });

            expect(report.positions).toHaveLength(1);
            const empReport = report.positions[0].employees[0];
            expect(empReport.dayValues['2026-08-23']).toBe(1.5); // 1 jornada * 1.5 factor
            expect(empReport.total).toBe(1.5);
        });
    });

    describe('Attendance Card UI rest-day tag rendering', () => {
        let AppStateModule;
        let AttendanceUIModule;

        beforeAll(async () => {
            AppStateModule = await import('../modules/core/AppState.js');
            AttendanceUIModule = await import('../modules/ui/AttendanceUI.js');
        });

        test('renders rest day pill when employee attends on non-working day', () => {
            const { state } = AppStateModule;
            const { EmployeeRow, EmployeeRowCompact } = AttendanceUIModule;

            state.selectedDate = new Date('2026-08-23T12:00:00'); // Domingo
            state.settings = {
                holidays: [],
                regularHoursPerDay: 8,
                restDayFactor: 1.5
            };
            state.positions = [
                { id: 'pos-1', name: 'Pintor', workingDays: [1, 2, 3, 4, 5], leaderId: 'ldr-1', restDayFactor: 2.0 }
            ];
            state.leaders = [
                { id: 'ldr-1', name: 'Pedro', restDayFactor: 1.75 }
            ];
            state.employees = [
                { id: 'emp-card-1', number: '010', name: 'Mario Rossi', active: true, positions: ['pos-1'] }
            ];
            state.attendance = {
                'emp-card-1-2026-08-23': {
                    present: true,
                    hoursWorked: 8,
                    selectedPosition: 'pos-1'
                }
            };

            const fullHtml = EmployeeRow(state.employees[0]);
            expect(fullHtml).toContain('attendance-status-pill is-rest-day');
            expect(fullHtml).toContain('Día libre (1.75x)');

            const compactHtml = EmployeeRowCompact(state.employees[0]);
            expect(compactHtml).toContain('attendance-status-pill is-rest-day');
            expect(compactHtml).toContain('Día libre (1.75x)');
        });

        // Revisión externa del PR #366: la tarjeta debe mostrar el mismo factor que paga la nómina.
        test('a day worked before the employee changed leader shows the factor payroll pays for it', async () => {
            const { state } = AppStateModule;
            const { EmployeeRow, EmployeeRowCompact } = AttendanceUIModule;
            const { prepareEmployeePositionAssignments, captureAttendancePositionAssignments } = await import('../modules/features/employees/EmployeePositionAssignments.js');
            const { PayrollService } = await import('../modules/features/payroll/PayrollService.js');
            const start = new Date('2026-08-17T08:00:00').getTime();
            state.selectedDate = new Date('2026-08-23T12:00:00'); // Domingo
            state.settings = { holidays: [], regularHoursPerDay: 8, restDayFactor: 1.5, overtimeFactor: 1, holidayFactor: 2 };
            state.positions = [{ id: 'pos-1', name: 'Pintor', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5], leaderId: 'ldr-2' }];
            state.leaders = [{ id: 'ldr-1', name: 'Luis', restDayFactor: 3 }, { id: 'ldr-2', name: 'Marcos', restDayFactor: 2 }];
            const employee = { id: 'emp-card-2', number: '011', name: 'Juan', active: true, positions: ['pos-1'] };
            const plain = () => JSON.parse(JSON.stringify({ positions: state.positions, leaders: state.leaders, settings: state.settings, employees: [employee], attendance: {} }));
            employee.positionAssignments = prepareEmployeePositionAssignments(employee, { 'pos-1': { workLeaderId: 'ldr-1' } }, plain(), start);
            const worked = new Date('2026-08-23T18:00:00').getTime();
            const record = captureAttendancePositionAssignments({ employeeId: employee.id, date: '2026-08-23', present: true, hoursWorked: 8,
                selectedPosition: 'pos-1', createdAt: worked, updatedAt: worked }, plain(), worked);
            // Días después pasa al equipo de Marcos (2x).
            employee.positionAssignments = prepareEmployeePositionAssignments(employee, { 'pos-1': { workLeaderId: 'ldr-2' } }, plain(), new Date('2026-08-26T08:00:00').getTime());
            state.employees = [employee];
            state.attendance = { 'emp-card-2-2026-08-23': record };

            const paid = new PayrollService(plain.call(null) && { ...plain(), attendance: { 'emp-card-2-2026-08-23': record } })
                .calculateEmployeePayroll(employee.id, '2026-08-23', '2026-08-23', [], [], []);
            expect(paid.breakdown[0].restDayFactor).toBe(3);
            expect(EmployeeRow(state.employees[0])).toContain('Día libre (3x)');
            expect(EmployeeRowCompact(state.employees[0])).toContain('Día libre (3x)');
        });

        test('does not render rest day pill on normal working day', () => {
            const { state } = AppStateModule;
            const { EmployeeRow } = AttendanceUIModule;

            state.selectedDate = new Date('2026-08-24T12:00:00'); // Lunes (día laborable)
            state.attendance = {
                'emp-card-1-2026-08-24': {
                    present: true,
                    hoursWorked: 8,
                    selectedPosition: 'pos-1'
                }
            };

            const html = EmployeeRow(state.employees[0]);
            expect(html).not.toContain('is-rest-day');
            expect(html).not.toContain('Día libre');
        });

        test('renders rest day factor tag per each position in multi-position breakdown', () => {
            const { state } = AppStateModule;
            const { EmployeeRow } = AttendanceUIModule;

            state.selectedDate = new Date('2026-08-23T12:00:00'); // Domingo
            state.settings = {
                holidays: [],
                regularHoursPerDay: 8,
                restDayFactor: 1.5
            };
            state.positions = [
                { id: 'pos-a', name: 'Ayudante', workingDays: [1, 2, 3, 4, 5], leaderId: null, restDayFactor: 1.5 },
                { id: 'pos-b', name: 'Ayudante Avanzado', workingDays: [1, 2, 3, 4, 5], leaderId: null, restDayFactor: 2.0 }
            ];
            state.employees = [
                {
                    id: 'emp-multi-1',
                    number: '003',
                    name: 'Vernet Gran Pierre',
                    active: true,
                    positions: ['pos-a', 'pos-b']
                }
            ];
            state.attendance = {
                'emp-multi-1-2026-08-23': {
                    present: true,
                    hoursWorked: 11,
                    multiPosition: true,
                    positionHours: [
                        { positionId: 'pos-a', hours: 5, overtimeHours: 0 },
                        { positionId: 'pos-b', hours: 6, overtimeHours: 0 }
                    ]
                }
            };

            const html = EmployeeRow(state.employees[0]);
            expect(html).toContain('multi-position-breakdown');
            expect(html).toContain('Día libre (1.5x)');
            expect(html).toContain('Día libre (2x)');
        });
    });

    describe('Leader and Position classes persistence (restDayFactor round-trip)', () => {
        let LeaderClass;
        let PositionClass;

        beforeAll(async () => {
            const leaderModule = await import('../modules/features/employees/Leader.js');
            const positionModule = await import('../modules/features/employees/Position.js');
            LeaderClass = leaderModule.Leader;
            PositionClass = positionModule.Position;
        });

        test('Leader retains and serializes restDayFactor', () => {
            const ldr = new LeaderClass({
                id: 'ldr-100',
                name: 'Ingeniero Jefe',
                restDayFactor: 1.75
            });
            expect(ldr.restDayFactor).toBe(1.75);

            const json = ldr.toJSON();
            expect(json.restDayFactor).toBe(1.75);

            const restored = LeaderClass.fromJSON(json);
            expect(restored.restDayFactor).toBe(1.75);
        });

        test('Position retains and serializes restDayFactor', () => {
            const pos = new PositionClass({
                id: 'pos-200',
                name: 'Electricista',
                hourlyRate: 150,
                restDayFactor: 2.25
            });
            expect(pos.restDayFactor).toBe(2.25);

            const json = pos.toJSON();
            expect(json.restDayFactor).toBe(2.25);

            const restored = PositionClass.fromJSON(json);
            expect(restored.restDayFactor).toBe(2.25);
        });
    });
});
