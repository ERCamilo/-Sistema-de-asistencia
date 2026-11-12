import * as AnalyticsUI from '../modules/features/analytics/AnalyticsUI.js';
import { stateManager } from '../modules/core/AppState.js';
import { captureAttendancePositionAssignments } from '../modules/features/employees/EmployeePositionAssignments.js';

describe('Employee Report Excel Export', () => {
    let state;
    let notifications;
    let addedWorksheets;

    class MockWorksheet {
        constructor(name) {
            this.name = name;
            this.columns = [];
            this.rows = [];
            this.views = [];
            this.autoFilter = null;
            this.cells = {};
        }

        get columnCount() {
            return this.columns.length || 10;
        }

        get rowCount() {
            return this.rows.length;
        }

        getCell(addr) {
            if (!this.cells[addr]) {
                this.cells[addr] = { value: '', font: {}, style: {} };
            }
            return this.cells[addr];
        }

        getColumn(col) {
            return { width: 10 };
        }

        getRow(num) {
            if (!this.rows[num - 1]) {
                this.rows[num - 1] = {
                    values: [],
                    height: 20,
                    hidden: false,
                    eachCell: (fn) => {
                        Object.keys(this.cells).forEach(k => {
                            if (k.endsWith(String(num))) fn(this.cells[k], 1);
                        });
                    },
                    getCell: (idx) => ({ value: '', fill: {}, style: {} })
                };
            }
            return this.rows[num - 1];
        }

        addRow(rowObj) {
            const columns = this.columns;
            const rowInstance = {
                values: rowObj,
                hidden: false,
                cells: [],
                eachCell: function(fn) {
                    columns.forEach((_column, idx) => fn(this.getCell(idx + 1), idx + 1));
                },
                getCell: function(index) {
                    if (!this.cells[index - 1]) this.cells[index - 1] = {
                        value: this.values[columns[index - 1]?.key] ?? null, fill: {}, style: {}
                    };
                    return this.cells[index - 1];
                }
            };
            this.rows.push(rowInstance);
            return rowInstance;
        }

        insertRow(idx, rowValues) {
            const rowInstance = {
                values: rowValues,
                hidden: false,
                height: 25,
                eachCell: function(fn) {
                    (Array.isArray(this.values) ? this.values : []).forEach((val, i) => {
                        fn({ value: val, style: {}, fill: {} }, i + 1);
                    });
                },
                getCell: () => ({ value: '', fill: {}, style: {} })
            };
            this.rows.splice(idx - 1, 0, rowInstance);
            return rowInstance;
        }

        mergeCells() {}

        eachRow(fn) {
            this.rows.forEach((r, idx) => fn(r, idx + 1));
        }
    }

    class MockWorkbook {
        constructor() {
            this.worksheets = [];
            this.xlsx = {
                writeBuffer: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
            };
        }

        addWorksheet(name) {
            const ws = new MockWorksheet(name);
            this.worksheets.push(ws);
            addedWorksheets.push(ws);
            return ws;
        }
    }

    beforeEach(() => {
        addedWorksheets = [];
        notifications = [];

        state = {
            settings: {
                companyName: 'Test Corp',
                regularHoursPerDay: 8,
                holidays: []
            },
            employeeReportStartDate: '2026-08-01',
            employeeReportEndDate: '2026-08-03',
            dayHoursConfig: {},
            leaders: [
                { id: 'lead-1', name: 'Líder Uno' }
            ],
            positions: [
                { id: 'pos-1', name: 'Albañil', leaderId: 'lead-1', active: true, workingDays: [1, 2, 3, 4, 5] },
                { id: 'pos-2', name: 'Pintor', leaderId: 'lead-1', active: true, workingDays: [1, 2, 3, 4, 5] }
            ],
            employees: [
                {
                    id: 'emp-1',
                    number: '1',
                    name: 'Juan Perez',
                    positions: ['pos-1'],
                    active: true
                },
                {
                    id: 'emp-2',
                    number: '2',
                    name: 'Maria Gomez',
                    positions: ['pos-1'],
                    active: false // Inactive employee with 0 days
                },
                {
                    id: 'emp-3',
                    number: '3',
                    name: 'Pedro Ruiz',
                    positions: ['pos-1'],
                    active: true
                },
                {
                    id: 'emp-4',
                    number: '6',
                    name: 'Ana Lopez',
                    positions: ['pos-1'],
                    active: true
                }
            ],
            attendance: {
                'emp-1-2026-08-01': { present: true, hoursWorked: 8, selectedPosition: 'pos-1' },
                'emp-3-2026-08-01': { present: true, hoursWorked: 8, selectedPosition: 'pos-1' },
                'emp-4-2026-08-01': { present: true, hoursWorked: 8, selectedPosition: 'pos-1' }
            }
        };

        stateManager.getState = jest.fn(() => state);

        window.ExcelJS = {
            Workbook: MockWorkbook
        };

        window.showNotification = jest.fn((msg, type) => {
            notifications.push({ msg, type });
        });

        // Mock URL.createObjectURL and document.createElement('a')
        global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
        const clickMock = jest.fn();
        const originalCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
            if (tagName === 'a') {
                return {
                    href: '',
                    download: '',
                    click: clickMock,
                    setAttribute: jest.fn(),
                    style: {}
                };
            }
            return originalCreateElement(tagName);
        });

        // Mock services.ensureAttendanceRange and pass ctx with state
        AnalyticsUI.init?.({
            state,
            render: jest.fn(),
            saveToLocalStorage: jest.fn(),
            services: {
                ensureAttendanceRange: jest.fn().mockResolvedValue()
            }
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('exports sheets in the correct hierarchy: Dashboard -> Resumen -> Líderes -> Posiciones', async () => {
        await AnalyticsUI.exportEmployeeReportExcel();

        const sheetNames = addedWorksheets.map(ws => ws.name);
        expect(sheetNames[0]).toBe('Dashboard de Control');
        expect(sheetNames[1]).toBe('Resumen General');
        expect(sheetNames[2]).toBe('Líder - Líder Uno');
        expect(sheetNames[3]).toBe('Albañil');
    });

    test('includes inactive employees in leader sheets in natural numerical order with hidden=true', async () => {
        await AnalyticsUI.exportEmployeeReportExcel();

        const leaderSheet = addedWorksheets.find(ws => ws.name === 'Líder - Líder Uno');
        expect(leaderSheet).toBeDefined();

        // Find data rows in leader sheet
        const dataRows = leaderSheet.rows.filter(r => r.values && r.values.idx !== undefined);
        expect(dataRows.length).toBe(6);

        // Verify order: Juan (#1), Maria (#2), Pedro (#3), Gap (#4), Gap (#5), Ana (#6)
        expect(dataRows[0].values.idx).toBe('1');
        expect(dataRows[0].values.name).toBe('Juan Perez');
        expect(dataRows[0].hidden).toBe(false);

        expect(dataRows[1].values.idx).toBe('2');
        expect(dataRows[1].values.name).toBe('Maria Gomez');
        expect(dataRows[1].hidden).toBe(true); // Inactive row is hidden!

        expect(dataRows[2].values.idx).toBe('3');
        expect(dataRows[2].values.name).toBe('Pedro Ruiz');
        expect(dataRows[2].hidden).toBe(false);

        // Gap rows
        expect(dataRows[3].values.idx).toBe('4');
        expect(dataRows[3].values.name).toBe('');
        expect(dataRows[3].hidden).toBe(true); // Gap row is hidden!

        expect(dataRows[4].values.idx).toBe('5');
        expect(dataRows[4].values.name).toBe('');
        expect(dataRows[4].hidden).toBe(true); // Gap row is hidden!

        expect(dataRows[5].values.idx).toBe('6');
        expect(dataRows[5].values.name).toBe('Ana Lopez');
        expect(dataRows[5].hidden).toBe(false);
    });

    test('includes dual total columns with formula for Total Días (Calculado)', async () => {
        await AnalyticsUI.exportEmployeeReportExcel();

        const leaderSheet = addedWorksheets.find(ws => ws.name === 'Líder - Líder Uno');
        const juanRow = leaderSheet.rows.find(r => r.values && r.values.idx === '1');

        expect(juanRow.values.totalExported).toBe(1.5);
        expect(juanRow.values.totalCalculated).toBeDefined();
        expect(juanRow.values.totalCalculated.formula).toContain('SUM(');
        expect(juanRow.values.totalCalculated.result).toBe(1.5);
    });

    test('enables autoFilter on data sheets', async () => {
        await AnalyticsUI.exportEmployeeReportExcel();

        const leaderSheet = addedWorksheets.find(ws => ws.name === 'Líder - Líder Uno');
        expect(leaderSheet.autoFilter).toBeDefined();
        expect(leaderSheet.autoFilter.from.row).toBe(2);

        const posSheet = addedWorksheets.find(ws => ws.name === 'Albañil');
        expect(posSheet.autoFilter).toBeDefined();
        expect(posSheet.autoFilter.from.row).toBe(2);
    });
    test('pays borrowed work once in the payer sheet and puts a separate signed leader adjustment outside days', async () => {
        state.employeeReportStartDate = '2026-11-09'; state.employeeReportEndDate = '2026-11-09';
        state.leaders = [{ id: 'L1', name: 'Luis' }, { id: 'L2', name: 'Marcos' }];
        state.positions = [
            { id: 'p1', name: 'Albañil', leaderId: 'L1', hourlyRate: 112.5, active: true, workingDays: [0,1,2,3,4,5,6] },
            { id: 'p2', name: 'Electricista', leaderId: 'L2', hourlyRate: 112.5, active: true, workingDays: [0,1,2,3,4,5,6] },
            { id: 'p3', name: 'Ayudante', leaderId: 'L2', hourlyRate: 62.5, active: true, workingDays: [0,1,2,3,4,5,6] }
        ];
        state.employees = [{ id: 'juan', name: 'Juan Pérez', number: '113', active: true, positions: ['p1','p2'],
            positionAssignments: { p2: { workLeaderId: 'L2', payerLeaderId: 'L1', isLoanPosition: true } } },
            { id: 'rosa', name: 'Rosa Díaz', number: '024', active: true, positions: ['p3'] }];
        state.attendance = Object.fromEntries([['juan','p2'],['rosa','p3']].map(([employeeId,selectedPosition]) => [
            `${employeeId}-2026-11-09`, { employeeId, date:'2026-11-09', present:true, selectedPosition, hoursWorked:8, overtimeHours:0 }
        ]));
        await AnalyticsUI.exportEmployeeReportExcel();
        const payer = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis');
        const team = addedWorksheets.find(sheet => sheet.name === 'Líder - Marcos');
        expect(payer.rows.find(row => row.values.name === 'Juan Pérez').values).toMatchObject({ gross:900, net:900, totalExported:1 });
        expect(team.rows.find(row => row.values.name === 'Rosa Díaz').values).toMatchObject({ gross:500, net:500 });
        const group = team.rows.find(row => row.values.name === 'Personal pagado por otros líderes').values;
        expect(group).toMatchObject({ leaderAdjustment:-900, leaderBalance:-400 });
        expect(group.totalExported).toBeUndefined();
        const debit = team.rows.find(row => row.values.name === 'Juan Pérez');
        expect(debit.values).toMatchObject({ '2026-11-09': -1, totalExported: -1 });
        expect(debit.values.gross).toBeUndefined();
        expect(debit.values.net).toBeUndefined();
        expect(debit.getCell(4).note).toContain('Se le descuenta a Marcos');
    });

    function splitLoanScenario({ mode = 'inline', sunday = false, disabled = false } = {}) {
        const date = sunday ? '2026-11-15' : '2026-11-09';
        state.employeeReportStartDate = date; state.employeeReportEndDate = date;
        state.settings = { companyName: 'Prueba', regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, restDayFactor: 1.5, holidays: [] };
        state.excelExportOptions = { loanPositionLayout: mode, padNumericalGaps: false, dualTotalColumns: true, useFormulas: true };
        state.leaders = [{ id: 'L1', name: 'Luis' }, { id: 'L2', name: 'Marcos' }];
        state.positions = [
            { id: 'p1', name: 'Albañil', leaderId: 'L1', hourlyRate: 100, active: true, workingDays: [1, 2, 3, 4, 5, 6] },
            { id: 'p2', name: 'Electricista', leaderId: 'L2', hourlyRate: 200, active: true, workingDays: [1, 2, 3, 4, 5, 6] }
        ];
        state.employees = [{ id: 'e', name: 'Juan', number: '00113', active: true, positions: ['p1', 'p2'],
            positionAssignments: { p2: { workLeaderId: 'L2', payerLeaderId: 'L1', isLoanPosition: true } } }];
        state.attendance = { [`e-${date}`]: { employeeId: 'e', date, present: true, selectedPosition: 'p1', hoursWorked: 8,
            positionHours: [{ positionId: 'p1', hours: 4 }, { positionId: 'p2', hours: 4 }] } };
        if (disabled) state.exportConfig = { payrollLeaderAdjustments: { [JSON.stringify(['local', 'legacy', date, date, 'L2'])]: false } };
        return date;
    }

    test('inline folds borrowed days into the primary row, with a plain charge note and unchanged money', async () => {
        const date = splitLoanScenario();
        const before = JSON.stringify({ employees: state.employees, attendance: state.attendance });
        await AnalyticsUI.exportEmployeeReportExcel();
        const payer = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis');
        const rows = payer.rows.filter(row => row.values.name === 'Juan');
        expect(rows).toHaveLength(1);
        expect(rows[0].values).toMatchObject({ idx: '00113', position: 'Albañil', [date]: 1, totalExported: 1, gross: 1200, net: 1200 });
        expect(rows[0].getCell(4).note).toBe('Electricista: 4 h\nAlbañil: 4 h\nSe le descuenta a Marcos');
        expect(rows[0].getCell(4).note).not.toContain('Paga:');
        expect(rows[0].getCell(4).fill.fgColor.argb).toBe('FFFFE69A');
        const team = addedWorksheets.find(sheet => sheet.name === 'Líder - Marcos');
        const debit = team.rows.find(row => row.values.name === 'Juan');
        expect(debit.values).toMatchObject({ [date]: -0.5, totalExported: -0.5 });
        expect(debit.values.totalCalculated.result).toBe(-0.5);
        const adjustment = team.rows.find(row => row.values.name === 'Personal pagado por otros líderes');
        expect(adjustment.values).toMatchObject({ leaderAdjustment: -800, leaderBalance: -800 });
        expect(team.rows.filter(row => Number(row.values.leaderAdjustment) < 0)).toHaveLength(1);
        expect(JSON.stringify({ employees: state.employees, attendance: state.attendance })).toBe(before);
    });

    test('separate mode preserves secondary rows and numeric fractions', async () => {
        const date = splitLoanScenario({ mode: 'separate' });
        await AnalyticsUI.exportEmployeeReportExcel();
        const rows = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis').rows.filter(row => row.values.name === 'Juan');
        expect(rows.map(row => row.values.idx)).toEqual(['00113', '00113b']);
        expect(rows.map(row => row.values[date])).toEqual([0.5, 0.5]);
        expect(rows.map(row => row.values.gross)).toEqual([400, 800]);
        expect(rows.map(row => row.values.net)).toEqual([1200, null]);
    });

    test('Sunday formatting preserves yellow notes and the existing weighted day values', async () => {
        const date = splitLoanScenario({ sunday: true });
        await AnalyticsUI.exportEmployeeReportExcel();
        const payer = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis').rows.find(row => row.values.name === 'Juan');
        expect(payer.values[date]).toBe(1.5);
        expect(payer.getCell(4).fill.fgColor.argb).toBe('FFFFE69A');
        const debit = addedWorksheets.find(sheet => sheet.name === 'Líder - Marcos').rows.find(row => row.values.name === 'Juan');
        expect(debit.values[date]).toBe(-0.75);
    });

    test('disabled leader adjustment has no applied negative days or second salary', async () => {
        const date = splitLoanScenario({ disabled: true });
        await AnalyticsUI.exportEmployeeReportExcel();
        const team = addedWorksheets.find(sheet => sheet.name === 'Líder - Marcos');
        expect(team.rows.find(row => row.values.name === 'Personal pagado por otros líderes').values)
            .toMatchObject({ position: 'Desactivado', leaderAdjustment: 0, leaderBalance: 0 });
        const debit = team.rows.find(row => row.values.name === 'Juan');
        expect(debit.values[date]).toBe(0);
        expect(debit.getCell(4).note).toContain('Descuento desactivado');
        expect(debit.values.net).toBeUndefined();
    });

    test('loan layout is the first configuration choice and changes without replacing the modal', () => {
        document.body.innerHTML = AnalyticsUI.ExcelExportOptionsModal();
        const field = document.querySelector('fieldset');
        expect(field.querySelector('legend').textContent).toBe('Posiciones de préstamo');
        const button = document.querySelector('[data-excel-loan-layout="inline"]');
        button.focus();
        AnalyticsUI.setLoanPositionLayout('inline');
        expect(state.excelExportOptions.loanPositionLayout).toBe('inline');
        expect(document.activeElement).toBe(button);
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(document.querySelector('[data-excel-loan-layout="separate"]').getAttribute('aria-pressed')).toBe('false');
    });

    test('loan-only work creates a primary row and preserves the secondary rate', async () => {
        const date = splitLoanScenario();
        state.attendance[`e-${date}`].positionHours = [{ positionId: 'p2', hours: 8 }];
        state.attendance[`e-${date}`].selectedPosition = 'p2';
        await AnalyticsUI.exportEmployeeReportExcel();
        const rows = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis').rows.filter(row => row.values.name === 'Juan');
        expect(rows).toHaveLength(1);
        expect(rows[0].values).toMatchObject({ position: 'Albañil', [date]: 1, gross: 1600, net: 1600 });
        expect(rows[0].getCell(4).note).toBe('Electricista: 8 h\nSe le descuenta a Marcos');
    });

    test('inline retains a secondary non-loan job instead of folding all positions', async () => {
        const date = splitLoanScenario();
        state.positions.push({ ...state.positions[0], id: 'p3', name: 'Pintor', hourlyRate: 50 });
        state.employees[0].positions.push('p3');
        state.attendance[`e-${date}`].positionHours = [{ positionId: 'p1', hours: 2 }, { positionId: 'p2', hours: 4 }, { positionId: 'p3', hours: 2 }];
        await AnalyticsUI.exportEmployeeReportExcel();
        const rows = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis').rows.filter(row => row.values.name === 'Juan');
        expect(rows.map(row => row.values.position)).toEqual(['Albañil', 'Pintor']);
        expect(rows.map(row => row.values[date])).toEqual([0.75, 0.25]);
        expect(rows.map(row => row.values.gross)).toEqual([1000, 100]);
        expect(rows.map(row => row.values.net)).toEqual([1100, null]);
    });

    test('zero placeholders on other dates do not leave an extra borrowed-position row', async () => {
        const date = splitLoanScenario();
        const tomorrow = '2026-11-10';
        state.employeeReportEndDate = tomorrow;
        state.attendance[`e-${date}`].positionHours = [{ positionId: 'p1', hours: 8 }];
        state.attendance[`e-${tomorrow}`] = { employeeId: 'e', date: tomorrow, present: true, selectedPosition: 'p2', hoursWorked: 8 };
        await AnalyticsUI.exportEmployeeReportExcel();
        const rows = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis').rows.filter(row => row.values.name === 'Juan');
        expect(rows).toHaveLength(1);
        expect(rows[0].values).toMatchObject({ position: 'Albañil', [date]: 1, [tomorrow]: 1, gross: 2400, net: 2400, totalExported: 2 });
    });

    test('same-named positions keep their own amounts by identifier', async () => {
        splitLoanScenario({ mode: 'separate' });
        state.positions[1].name = state.positions[0].name;
        // Position-only sheets already require unique names; assert the leader projection independently.
        await AnalyticsUI.exportEmployeeReportExcel();
        const rows = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis').rows.filter(row => row.values.name === 'Juan');
        expect(rows.map(row => row.values.gross)).toEqual([400, 800]);
    });

    test.each([true, false])('negative days use the selected total layout without changing formulas=%s', async useFormulas => {
        const date = splitLoanScenario();
        state.excelExportOptions = { ...state.excelExportOptions, useFormulas, dualTotalColumns: false };
        await AnalyticsUI.exportEmployeeReportExcel();
        const rows = addedWorksheets.find(sheet => sheet.name === 'Líder - Marcos').rows;
        const debit = rows.find(row => row.values.name === 'Juan');
        expect(debit.values.totalExported).toBeUndefined();
        expect(debit.values.days).toEqual(useFormulas ? { formula: `SUM(D${rows.indexOf(debit) + 1}:D${rows.indexOf(debit) + 1})`, result: -0.5 } : -0.5);
        expect(debit.values[date]).toBe(-0.5);
    });

    test('historical payer and team changes split the same position between the right sheets and dates', async () => {
        const date = splitLoanScenario();
        const record = { ...state.attendance[`e-${date}`], selectedPosition: 'p2', positionHours: [{ positionId: 'p2', hours: 8 }] };
        state.attendance[`e-${date}`] = captureAttendancePositionAssignments(record, state);
        const tomorrow = '2026-11-10';
        state.employeeReportEndDate = tomorrow;
        state.leaders.push({ id: 'L3', name: 'Ana' });
        state.employees[0].positionAssignments.p2 = { isLoanPosition: false, workLeaderId: 'L3', payerLeaderId: 'L3' };
        state.attendance[`e-${tomorrow}`] = captureAttendancePositionAssignments({ ...record, date: tomorrow }, state);
        await AnalyticsUI.exportEmployeeReportExcel();
        const luis = addedWorksheets.find(sheet => sheet.name === 'Líder - Luis').rows.find(row => row.values.name === 'Juan');
        expect(luis.values).toMatchObject({ [date]: 1, [tomorrow]: 0, gross: 1600, net: 1600 });
        const ana = addedWorksheets.find(sheet => sheet.name === 'Líder - Ana').rows.find(row => row.values.name === 'Juan');
        expect(ana.values).toMatchObject({ [date]: null, [tomorrow]: 1, gross: 1600, net: 1600 });
        const debit = addedWorksheets.find(sheet => sheet.name === 'Líder - Marcos').rows.find(row => row.values.name === 'Juan');
        expect(debit.values).toMatchObject({ [date]: -1, [tomorrow]: null, totalExported: -1 });
    });

    test('own work and borrowed work remain distinct in the charged leader sheet', async () => {
        const date = splitLoanScenario();
        const tomorrow = '2026-11-10';
        state.employeeReportEndDate = tomorrow;
        state.positions.push({ ...state.positions[1], id: 'p3', name: 'Ayudante', hourlyRate: 50 });
        state.employees[0].positions.push('p3');
        state.attendance[`e-${tomorrow}`] = { employeeId: 'e', date: tomorrow, present: true, selectedPosition: 'p3', hoursWorked: 8 };
        await AnalyticsUI.exportEmployeeReportExcel();
        const rows = addedWorksheets.find(sheet => sheet.name === 'Líder - Marcos').rows;
        const own = rows.find(row => row.values.position === 'Ayudante' && row.values.name === 'Juan');
        expect(own.values).toMatchObject({ [date]: 0, [tomorrow]: 1, gross: 400, net: 400 });
        const debit = rows.find(row => row.values.position === 'Descuento por préstamo de personal');
        expect(debit.values).toMatchObject({ [date]: -0.5, [tomorrow]: null, totalExported: -0.5 });
        expect(rows.find(row => row.values.name === 'Personal pagado por otros líderes').values).toMatchObject({ leaderAdjustment: -800, leaderBalance: -400 });
    });

});
