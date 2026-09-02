import * as AnalyticsUI from '../modules/features/analytics/AnalyticsUI.js';
import { stateManager } from '../modules/core/AppState.js';

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
            const rowInstance = {
                values: rowObj,
                hidden: false,
                cells: [],
                eachCell: function(fn) {
                    this.cells.forEach((c, idx) => fn(c, idx + 1));
                },
                getCell: () => ({ value: '', fill: {}, style: {} })
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
});
