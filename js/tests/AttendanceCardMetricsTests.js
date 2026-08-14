import {
    buildAttendanceCardPeriodMetrics,
    formatAttendanceDecimal,
    formatAttendanceDayNumber,
    formatAttendanceDeficit,
    normalizeRegularHoursPerDay
} from '../modules/features/attendance/AttendanceCardMetrics.js';

testRunner.addSuite('AttendanceCardPeriodMetrics', {
    'usa el período configurado y excluye feriados e inactividad del objetivo'() {
        const employee = {
            id: 'e1',
            positions: ['p1'],
            active: true,
            hireDate: '2026-05-05',
            customWorkingDays: { p1: [1, 2, 3, 4] }
        };
        const attendance = {
            'e1-2026-05-05': { present: true, hoursWorked: 4, overtimeHours: 2, selectedPosition: 'p1' },
            'e1-2026-05-06': { present: true, hoursWorked: 8, overtimeHours: 1, selectedPosition: 'p1' },
            'e1-2026-05-07': { present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p1' },
            'e1-2026-05-08': { notes: '<b>Llegó tarde</b>' }
        };
        const metrics = buildAttendanceCardPeriodMetrics({
            employee,
            selectedDate: new Date('2026-05-08T12:00:00'),
            today: new Date('2026-05-10T12:00:00'),
            attendance,
            positions: [{ id: 'p1', workingDays: [1, 2, 3, 4, 5] }],
            settings: {
                regularHoursPerDay: 8,
                holidays: ['2026-05-06'],
                payPeriod: { periodStart: '2026-05-01', periodLength: 15 }
            }
        });

        testRunner.assertEquals(metrics.source, 'configured', 'debe usar el período que contiene la fecha');
        testRunner.assertEquals(metrics.rangeStart, '2026-05-01');
        testRunner.assertEquals(metrics.rangeEnd, '2026-05-08');
        testRunner.assertEquals(metrics.scheduledDays, 2, 'solo 5 y 7 son jornadas elegibles');
        testRunner.assertEquals(metrics.workedDays, 1.5, '4/8 + 8/8 acredita 1.5 jornadas regulares');
        testRunner.assertEquals(metrics.deficitDays, 0.5, 'la media jornada faltante concuerda con las 4h de déficit');
        testRunner.assertEquals(metrics.deficitHours, 4);
        testRunner.assertEquals(metrics.overtimeHours, 3, 'las extras del rango se informan incluso en días no programados, sin cubrir déficit');
        testRunner.assertEquals(metrics.selectedDayNote, '<b>Llegó tarde</b>');
    },

    'fuera del período usa mes hasta fecha seleccionada y respeta overtime explícito cero'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'e2', positions: ['p1'], active: true },
            selectedDate: new Date('2026-04-10T12:00:00'),
            today: new Date('2026-05-10T12:00:00'),
            attendance: {
                'e2-2026-04-06': { present: true, hoursWorked: 10, overtimeHours: 0, selectedPosition: 'p1' }
            },
            positions: [{ id: 'p1', workingDays: [1, 2, 3, 4, 5] }],
            settings: {
                regularHoursPerDay: 8,
                holidays: [],
                payPeriod: { periodStart: '2026-05-01', periodLength: 15 }
            }
        });

        testRunner.assertEquals(metrics.source, 'month-to-date');
        testRunner.assertEquals(metrics.rangeStart, '2026-04-01');
        testRunner.assertEquals(metrics.rangeEnd, '2026-04-10');
        testRunner.assertEquals(metrics.overtimeHours, 0, 'cero explícito no debe derivar extras desde hoursWorked');
        testRunner.assertEquals(metrics.workedDays, 1, 'editar horas no altera el conteo de días presentes');
    },

    'limita fechas futuras a hoy y no crea déficit durante períodos inactivos'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: {
                id: 'e3', positions: ['p1'], active: true,
                statusHistory: [{ date: '2026-05-07', active: false, timestamp: 1 }]
            },
            selectedDate: new Date('2026-05-15T12:00:00'),
            today: new Date('2026-05-10T12:00:00'),
            attendance: {},
            positions: [{ id: 'p1', workingDays: [1, 2, 3, 4, 5] }],
            settings: {
                regularHoursPerDay: 8,
                holidays: [],
                payPeriod: { periodStart: '2026-05-01', periodLength: 31 }
            }
        });

        testRunner.assertEquals(metrics.rangeEnd, '2026-05-10', 'no debe proyectar jornadas posteriores a hoy');
        testRunner.assertEquals(metrics.scheduledDays, 4, 'los días inactivos desde el 7 no crean objetivo');
        testRunner.assertEquals(metrics.deficitHours, 32);
    },

    'usa el puesto realmente trabajado para resolver días personalizados en multiposición'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: {
                id: 'e4', positions: ['p1', 'p2'], active: true, hireDate: '2026-05-02',
                customWorkingDays: { p2: [6] }
            },
            selectedDate: new Date('2026-05-02T12:00:00'),
            today: new Date('2026-05-02T12:00:00'),
            attendance: {
                'e4-2026-05-02': {
                    present: true,
                    hoursWorked: 8,
                    overtimeHours: 0,
                    multiPosition: true,
                    positionHours: [{ positionId: 'p2', hours: 8, overtimeHours: 0 }]
                }
            },
            positions: [
                { id: 'p1', workingDays: [1, 2, 3, 4, 5] },
                { id: 'p2', workingDays: [1, 2, 3, 4, 5] }
            ],
            settings: {
                regularHoursPerDay: 8,
                holidays: [],
                payPeriod: { periodStart: '2026-05-01', periodLength: 15 }
            }
        });

        testRunner.assertEquals(metrics.scheduledDays, 1, 'el sábado personalizado de p2 debe ser elegible');
        testRunner.assertEquals(metrics.workedDays, 1);
    },

    'mantiene jornada programada completa aunque el objetivo diario sea 4h'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'e5', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: {
                'e5-2026-05-04': { present: true, hoursWorked: 4, overtimeHours: 0, selectedPosition: 'p1' }
            },
            positions: [{ id: 'p1', workingDays: [1] }],
            dayHoursConfig: { '2026-05-04': 4 },
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });

        testRunner.assertEquals(metrics.scheduledDays, 1, 'dayHoursConfig define horas esperadas, no media jornada');
        testRunner.assertEquals(metrics.workedDays, 1, 'un día presente cuenta una jornada sin prorratearse por horas');
        testRunner.assertEquals(metrics.deficitHours, 0);
    },

    'en días ausentes usa la unión de horarios de todos los puestos asignados'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: {
                id: 'e6', positions: ['p1', 'p2'], active: true, hireDate: '2026-05-02',
                customWorkingDays: { p1: [1], p2: [6] }
            },
            selectedDate: new Date('2026-05-02T12:00:00'),
            today: new Date('2026-05-02T12:00:00'),
            attendance: {},
            positions: [
                { id: 'p1', workingDays: [1, 2, 3, 4, 5] },
                { id: 'p2', workingDays: [1, 2, 3, 4, 5] }
            ],
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-02', periodLength: 1 } }
        });

        testRunner.assertEquals(metrics.scheduledDays, 1, 'el horario del puesto secundario debe programar el sábado ausente');
        testRunner.assertEquals(metrics.deficitHours, 8);
    },

    '5.5h de 8h acredita 0.6875 día y el déficit diario concordante'() {
        const args = {
            employee: { id: 'franklin', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-05T12:00:00'),
            today: new Date('2026-05-05T12:00:00'),
            positions: [{ id: 'p1', workingDays: [1, 2, 3, 4, 5] }],
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 15 } }
        };
        const fiveAndHalf = buildAttendanceCardPeriodMetrics({
            ...args,
            attendance: {
                'franklin-2026-05-04': { present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p1' },
                'franklin-2026-05-05': { present: true, hoursWorked: 5.5, overtimeHours: 0, selectedPosition: 'p1' }
            }
        });
        const eight = buildAttendanceCardPeriodMetrics({
            ...args,
            attendance: {
                'franklin-2026-05-04': { present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p1' },
                'franklin-2026-05-05': { present: true, hoursWorked: 8, overtimeHours: 0, selectedPosition: 'p1' }
            }
        });

        testRunner.assertEquals(fiveAndHalf.scheduledDays, 2);
        testRunner.assertEquals(fiveAndHalf.workedDays, 1.6875);
        testRunner.assertEquals(fiveAndHalf.creditedRegularDays, 1.6875);
        testRunner.assertEquals(fiveAndHalf.deficitDays, 0.3125);
        testRunner.assertEquals(fiveAndHalf.deficitHours, 2.5);
        testRunner.assertEquals(eight.workedDays, 2);
        testRunner.assertEquals(formatAttendanceDecimal(5.5 / 8), '0.6875', 'las horas/precisión genérica no cambian');
    },

    '4h de 8h acredita exactamente media jornada'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'half', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: { 'half-2026-05-04': { present: true, hoursWorked: 4, overtimeHours: 0, selectedPosition: 'p1' } },
            positions: [{ id: 'p1', workingDays: [1] }],
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });
        testRunner.assertEquals(metrics.workedDays, 0.5);
        testRunner.assertEquals(metrics.deficitDays, 0.5);
        testRunner.assertEquals(metrics.deficitHours, 4);
    },

    'las horas extra no completan crédito de jornada regular'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'ot-credit', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: { 'ot-credit-2026-05-04': { present: true, hoursWorked: 4, overtimeHours: 4, selectedPosition: 'p1' } },
            positions: [{ id: 'p1', workingDays: [1] }],
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });
        testRunner.assertEquals(metrics.workedDays, 0.5);
        testRunner.assertEquals(metrics.deficitDays, 0.5);
        testRunner.assertEquals(metrics.overtimeHours, 4);
    },

    '5.5h de 7.5h conserva cálculo sin redondear y display acotado explícito'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'seven-half', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: { 'seven-half-2026-05-04': { present: true, hoursWorked: 5.5, overtimeHours: 0, selectedPosition: 'p1' } },
            positions: [{ id: 'p1', workingDays: [1] }],
            settings: { regularHoursPerDay: '7.5', holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });
        testRunner.assertEquals(metrics.workedDays, 5.5 / 7.5);
        testRunner.assertEquals(metrics.deficitDays, 1 - (5.5 / 7.5));
        testRunner.assertEquals(metrics.deficitHours, 2);
        testRunner.assertEquals(formatAttendanceDecimal(metrics.workedDays), '0.733333333333');
        testRunner.assertEquals(formatAttendanceDeficit(metrics, 'days'), '−0.3 días');
    },

    'formatea días con máximo un decimal y redondeo decimal determinista'() {
        testRunner.assertEquals(formatAttendanceDayNumber(0.6875), '0.7');
        testRunner.assertEquals(formatAttendanceDayNumber(2.54), '2.5');
        testRunner.assertEquals(formatAttendanceDayNumber(2.55), '2.6');
        testRunner.assertEquals(formatAttendanceDayNumber(2.5), '2.5');
        testRunner.assertEquals(formatAttendanceDayNumber(3), '3');
    },

    'formatea déficit global en días u horas con decimales útiles'() {
        const metrics = { deficitDays: 2, deficitHours: 4 };
        testRunner.assertEquals(formatAttendanceDeficit(metrics, 'days'), '−2 días');
        testRunner.assertEquals(formatAttendanceDeficit({ deficitDays: 1, deficitHours: 8 }, 'days'), '−1 día');
        testRunner.assertEquals(formatAttendanceDeficit(metrics, 'hours'), '−4h');
    },

    'usa 6h configuradas para déficit y derivación legacy de extras'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'six', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-05T12:00:00'),
            today: new Date('2026-05-05T12:00:00'),
            attendance: {
                'six-2026-05-04': { present: true, hoursWorked: 5, selectedPosition: 'p1' },
                'six-2026-05-05': { present: true, hoursWorked: 8, selectedPosition: 'p1' }
            },
            positions: [{ id: 'p1', workingDays: [1, 2, 3, 4, 5] }],
            settings: { regularHoursPerDay: 6, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 2 } }
        });

        testRunner.assertEquals(metrics.workedDays, (5 / 6) + 1);
        testRunner.assertEquals(metrics.deficitDays, 2 - ((5 / 6) + 1));
        testRunner.assertEquals(metrics.scheduledHours, 12, 'dos jornadas deben usar 6h, nunca 8h');
        testRunner.assertEquals(metrics.deficitHours, 1, 'solo falta una hora en el primer día');
        testRunner.assertEquals(metrics.overtimeHours, 2, 'sin overtimeHours explícito debe derivar contra 6h');
    },

    'acepta 7.5h persistidas como string y dayHoursConfig solo reemplaza su fecha'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'seven', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-05T12:00:00'),
            today: new Date('2026-05-05T12:00:00'),
            attendance: {
                'seven-2026-05-04': { present: true, hoursWorked: 6, overtimeHours: 0, selectedPosition: 'p1' },
                'seven-2026-05-05': { present: true, hoursWorked: 7, overtimeHours: 0, selectedPosition: 'p1' }
            },
            positions: [{ id: 'p1', workingDays: [1, 2, 3, 4, 5] }],
            dayHoursConfig: { '2026-05-04': 6 },
            settings: { regularHoursPerDay: '7.5', holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 2 } }
        });

        testRunner.assertEquals(metrics.scheduledHours, 13.5, '6h del override + 7.5h configuradas');
        testRunner.assertEquals(metrics.deficitHours, 0.5);
        testRunner.assertEquals(metrics.workedDays, 1 + (7 / 7.5));
        testRunner.assertEquals(metrics.deficitDays, 2 - (1 + (7 / 7.5)));
    },

    'respeta cero explícito en dayHoursConfig sin convertirlo al fallback regular'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'zero-day', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: {},
            positions: [{ id: 'p1', workingDays: [1] }],
            dayHoursConfig: { '2026-05-04': 0 },
            settings: { regularHoursPerDay: 6, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });

        testRunner.assertEquals(metrics.scheduledDays, 1, 'sigue siendo un día calendario elegible');
        testRunner.assertEquals(metrics.scheduledHours, 0, 'el override explícito de cero se conserva');
        testRunner.assertEquals(metrics.deficitHours, 0, 'no debe caer accidentalmente a las 6h base');
        testRunner.assertEquals(metrics.deficitDays, 1, 'sin presencia sigue siendo ausencia diaria');
    },

    'respeta matriz 8h y 10h y centraliza inválidos en el default canónico'() {
        testRunner.assertEquals(normalizeRegularHoursPerDay(8), 8);
        testRunner.assertEquals(normalizeRegularHoursPerDay('10'), 10);
        testRunner.assertEquals(normalizeRegularHoursPerDay(0), 8);
        testRunner.assertEquals(normalizeRegularHoursPerDay('inválido'), 8);
    },

    'usa 10h para ausencia y evita doble contar extras multiposición explícitas'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'ten', positions: ['p1', 'p2'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-05T12:00:00'),
            today: new Date('2026-05-05T12:00:00'),
            attendance: {
                'ten-2026-05-04': {
                    present: true, hoursWorked: 10, overtimeHours: 2, multiPosition: true,
                    positionHours: [
                        { positionId: 'p1', hours: 5, overtimeHours: 1 },
                        { positionId: 'p2', hours: 5, overtimeHours: 1 }
                    ]
                }
            },
            positions: [
                { id: 'p1', workingDays: [1, 2] },
                { id: 'p2', workingDays: [1, 2] }
            ],
            settings: { regularHoursPerDay: '10', holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 2 } }
        });

        testRunner.assertEquals(metrics.scheduledHours, 20);
        testRunner.assertEquals(metrics.deficitHours, 10, 'la ausencia usa las 10h configuradas');
        testRunner.assertEquals(metrics.overtimeHours, 2, 'overtimeHours explícito gana y no se suma otra vez positionHours');
    },

    'override diario de 10h clasifica 10h como regulares sin extra derivada'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'override-ten', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: { 'override-ten-2026-05-04': { present: true, hoursWorked: 10, selectedPosition: 'p1' } },
            positions: [{ id: 'p1', workingDays: [1] }],
            dayHoursConfig: { '2026-05-04': 10 },
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });
        testRunner.assertEquals(metrics.workedDays, 1);
        testRunner.assertEquals(metrics.deficitHours, 0);
        testRunner.assertEquals(metrics.overtimeHours, 0);
    },

    'override diario de 10h deriva solo 1h extra al trabajar 11h'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'override-eleven', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: { 'override-eleven-2026-05-04': { present: true, hoursWorked: 11, selectedPosition: 'p1' } },
            positions: [{ id: 'p1', workingDays: [1] }],
            dayHoursConfig: { '2026-05-04': 10 },
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });
        testRunner.assertEquals(metrics.workedDays, 1);
        testRunner.assertEquals(metrics.deficitHours, 0);
        testRunner.assertEquals(metrics.overtimeHours, 1);
    },

    'override diario menor de 6h gobierna crédito y extra derivada'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'override-six', positions: ['p1'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: { 'override-six-2026-05-04': { present: true, hoursWorked: 7, selectedPosition: 'p1' } },
            positions: [{ id: 'p1', workingDays: [1] }],
            dayHoursConfig: { '2026-05-04': 6 },
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });
        testRunner.assertEquals(metrics.workedDays, 1);
        testRunner.assertEquals(metrics.deficitHours, 0);
        testRunner.assertEquals(metrics.overtimeHours, 1);
    },

    'overtime explícito sigue siendo autoritativo con override diario'() {
        const metrics = buildAttendanceCardPeriodMetrics({
            employee: { id: 'override-explicit', positions: ['p1', 'p2'], active: true, hireDate: '2026-05-04' },
            selectedDate: new Date('2026-05-04T12:00:00'),
            today: new Date('2026-05-04T12:00:00'),
            attendance: {
                'override-explicit-2026-05-04': {
                    present: true,
                    hoursWorked: 11,
                    overtimeHours: 2,
                    positionHours: [
                        { positionId: 'p1', hours: 6, overtimeHours: 1 },
                        { positionId: 'p2', hours: 5, overtimeHours: 1 }
                    ]
                }
            },
            positions: [{ id: 'p1', workingDays: [1] }, { id: 'p2', workingDays: [1] }],
            dayHoursConfig: { '2026-05-04': 10 },
            settings: { regularHoursPerDay: 8, holidays: [], payPeriod: { periodStart: '2026-05-04', periodLength: 1 } }
        });
        testRunner.assertEquals(metrics.workedDays, 1);
        testRunner.assertEquals(metrics.overtimeHours, 2, 'el valor explícito gana sin sumar positionHours ni derivar otra hora');
    }
});
