import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const functionBody = (src, name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) return '';
    const next = src.indexOf('\nfunction ', start + 10);
    return src.slice(start, next > start ? next : start + 12000);
};

describe('F1 R02 — review gates discovered after first correction pass', () => {
    test('Dashboard analytics scopes every operational chart/KPI by active project', () => {
        const src = read('modules/features/analytics/AnalyticsUI.js');
        for (const name of ['getAttendanceChartData','getHoursChartData','getPositionsChartData','getTop10ChartData','getHeatmapData','calculateReportData']) {
            const body = functionBody(src, name);
            expect(body).toMatch(/entityInScope|getScopedAnalytics|project.*scope/i);
        }
    });

    test('Excel export does not fall back to global employee/leader/position catalogs after scoped reportData', () => {
        const src = read('modules/features/analytics/AnalyticsUI.js');
        const start = src.indexOf('export async function exportEmployeeReportExcel()');
        const end = src.indexOf('export async function closeExcelExportModal', start);
        const body = src.slice(start, end > start ? end : start + 50000);
        expect(body).not.toMatch(/state\.leaders\.forEach\(/);
        expect(body).not.toMatch(/\(state\.positions\s*\|\|\s*\[\]\)\.filter\(/);
        expect(body).not.toMatch(/\(state\.employees\s*\|\|\s*\[\]\)\.forEach\(/);
    });

    test('Attendance detail treats attendance records outside active project as empty', () => {
        const src = read('app.js');
        const start = src.indexOf('function _AttendanceDetailPanelInner()');
        const end = src.indexOf('function AttendanceDayView', start);
        const body = src.slice(start, end > start ? end : start + 26000);
        expect(body).toMatch(/attRaw[\s\S]{0,260}entityInScope\(attRaw/);
    });

    test('FULL import reports success only after durable main data and petty cash work complete', () => {
        const src = read('modules/features/export/ExportController.js');
        const start = src.indexOf('async function applyFullImport(importedData)');
        const end = src.indexOf('export function confirmImportFull()', start);
        const body = src.slice(start, end);
        const durableAt = body.indexOf('await saveToIndexedDB');
        const pettyAt = body.indexOf('await restorePettyCashFromImport');
        const successAt = body.indexOf("notify('✅ Datos importados correctamente'");
        expect(durableAt).toBeGreaterThanOrEqual(0);
        expect(pettyAt).toBeGreaterThanOrEqual(0);
        expect(successAt).toBeGreaterThan(durableAt);
        expect(successAt).toBeGreaterThan(pettyAt);
    });
});
