import fs from 'node:fs';
import path from 'node:path';
import { state } from '../modules/core/AppState.js';
import { DayView, WeekView } from '../modules/ui/AttendanceUI.js';

const readSource = relativePath =>
    fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const appSource = readSource('app.js');
const serviceWorkerSource = readSource('../sw.js');
const attendanceStyles = readSource('../css/attendance_ui.css');

describe('Mini attendance day-view integration', () => {
    let originalEmployees;

    beforeEach(() => {
        originalEmployees = state.employees;
        state.employees = [];
        document.body.innerHTML = '';
        window.openMiniAttendanceImport = jest.fn();
    });

    afterEach(() => {
        state.employees = originalEmployees;
        delete window.openMiniAttendanceImport;
    });

    test('renders the Mini launcher only in DayView', () => {
        const day = DayView();
        const week = WeekView();

        expect(day).toContain('class="attendance-bulk-btn attendance-bulk-btn-mini"');
        expect(day).toContain('class="attendance-bulk-actions"');
        expect(day).toContain('data-att-action="open-mini-attendance-import"');
        expect(day).toContain('Importar desde Mini');
        expect(week).not.toContain('open-mini-attendance-import');
    });

    test('delegated launcher action calls the app bridge', () => {
        document.body.innerHTML = DayView();

        document.querySelector('[data-att-action="open-mini-attendance-import"]').click();

        expect(window.openMiniAttendanceImport).toHaveBeenCalledTimes(1);
    });

    test('app bridge opens the modal with current attendance dependencies', () => {
        expect(appSource).toMatch(
            /import\s+\{\s*MiniAttendanceImportModal\s*\}\s+from\s+['"]\.\/modules\/ui\/modals\/MiniAttendanceImportModal\.js['"]/
        );
        expect(appSource).toMatch(/window\.openMiniAttendanceImport\s*=\s*async\s*\(\)\s*=>/);
        expect(appSource).toMatch(/employees:\s*state\.employees/);
        expect(appSource).toMatch(/positions:\s*state\.positions/);
        expect(appSource).toMatch(/attendance:\s*state\.attendance/);
        expect(appSource).toMatch(/proposedDate:\s*getDateKey\(state\.selectedDate\)/);
        expect(appSource).toMatch(/regularLimit:\s*getDayHours\(state\.selectedDate\)/);
        expect(appSource).toMatch(/miniAttendanceAliasStore\.list\(aliasScope\)/);
        expect(appSource).toMatch(/aliasStore:\s*miniAttendanceAliasStore/);
        expect(appSource).toMatch(/new\s+MiniAttendanceImportModal\s*\([\s\S]*?\)\.open\(\)/);
    });

    test('offline shell includes every Mini production module', () => {
        const requiredModules = [
            './js/modules/features/attendance/MiniAttendanceParser.js',
            './js/modules/features/attendance/MiniAttendanceDraft.js',
            './js/modules/features/attendance/MiniAttendanceImportService.js',
            './js/modules/ui/modals/MiniAttendanceImportModal.js',
            './js/modules/services/MiniAttendanceAliasStore.js'
        ];

        requiredModules.forEach(modulePath => {
            expect(serviceWorkerSource).toContain(`'${modulePath}'`);
        });
    });

    test('launcher and modal workflow have compact responsive styles', () => {
        expect(attendanceStyles).toMatch(/\.attendance-bulk-btn-mini\s*\{/);
        expect(attendanceStyles).toMatch(
            /\.attendance-bulk-bar\s*\{[\s\S]*?container:\s*attendance-bulk\s*\/\s*inline-size;/
        );
        expect(attendanceStyles).toMatch(
            /@container\s+attendance-bulk\s*\(max-width:\s*560px\)[\s\S]*?\.attendance-bulk-context\s*\{[\s\S]*?display:\s*none;/
        );
        expect(attendanceStyles).toMatch(
            /\.attendance-bulk-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/
        );
        expect(attendanceStyles).toMatch(/\.mini-import-action\s*\{/);
        expect(attendanceStyles).toMatch(/\.mini-import-review-row\s*,\s*\.mini-import-conflict-row/);
        expect(attendanceStyles).toContain('.mini-import-setup input[type="date"]');
        expect(attendanceStyles).toContain('.mini-import-review input[type="number"]');
        expect(attendanceStyles).not.toMatch(/\.mini-import-(?:setup|review) input\s*,/);
        expect(attendanceStyles).toMatch(
            /\.mini-import-setup input\[type="radio"\],[\s\S]*?\.mini-import-review input\[type="checkbox"\]\s*\{[\s\S]*?width:\s*auto;[\s\S]*?justify-self:\s*start;/
        );
        expect(attendanceStyles).toMatch(
            /@media\s*\(max-width:\s*760px\)[\s\S]*?\.mini-import-review-row/
        );
        expect(attendanceStyles).toMatch(
            /@media\s*\(max-width:\s*480px\)[\s\S]*?\.attendance-bulk-actions/
        );
    });
});
