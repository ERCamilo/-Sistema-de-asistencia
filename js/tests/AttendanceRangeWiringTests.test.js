const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const FIREBASE = read('../modules/services/FirebaseService.js');
const PERSISTENCE = read('../modules/services/PersistenceService.js');
const APP = read('../app.js');
const ANALYTICS = read('../modules/features/analytics/AnalyticsUI.js');

describe('attendance range loading wiring', () => {
    test('Firebase exposes bounded document-id reads without passive lastAccessed writes', () => {
        const rangeMethod = FIREBASE.slice(
            FIREBASE.indexOf('async getAttendanceRange('),
            FIREBASE.indexOf('async getAllAttendance(')
        );
        const subscription = FIREBASE.slice(
            FIREBASE.indexOf('subscribeToAttendanceZonal('),
            FIREBASE.indexOf('async getFullState(')
        );

        expect(rangeMethod).toContain("where(documentId(), '>=', startDate)");
        expect(rangeMethod).toContain("where(documentId(), '<=', endDate)");
        expect(rangeMethod).not.toMatch(/lastAccessed\s*=\s*Date\.now/);
        expect(subscription).not.toMatch(/lastAccessed\s*=\s*Date\.now/);
    });

    test('PersistenceService merges explicit ranges and re-caches them in attendance IndexedDB', () => {
        expect(PERSISTENCE).toContain('createAttendanceRangeLoader({');
        expect(PERSISTENCE).toContain('FirebaseService.getAttendanceRange(startDate, endDate)');
        expect(PERSISTENCE).toContain("indexedDBService.batchUpdate('attendance', records)");
        expect(PERSISTENCE).toMatch(/export function ensureAttendanceRange\(startDate, endDate\)/);
    });

    test('every dashboard export awaits its complete attendance range', () => {
        for (const name of ['exportExcel', 'exportPDF', 'exportCSV']) {
            const block = APP.match(new RegExp(`window\\.${name}\\s*=\\s*async function[\\s\\S]*?\\n};`))?.[0] || '';
            expect(block).toContain('await ensureAttendanceRange(');
            expect(block.indexOf('await ensureAttendanceRange(')).toBeLessThan(block.indexOf('calculateReportData('));
        }
    });

    test('attendance navigation awaits an uncached selected range before rendering', () => {
        expect(APP).toMatch(/async function _ensureSelectedAttendanceRange\(\)/);
        expect(APP).toMatch(/cachedStart && startDate >= cachedStart && endDate <= cachedEnd/);
        for (const name of ['changeDate', 'goToToday', 'selectDate']) {
            const start = APP.lastIndexOf(`window.${name}`);
            const block = APP.slice(start, start + 1800);
            expect(block).toContain('await _ensureSelectedAttendanceRange();');
            expect(block.indexOf('await _ensureSelectedAttendanceRange();')).toBeLessThan(block.indexOf('window.updateAttendanceSubscription?.();'));
        }
    });

    test('employee Excel report loads its range before calculating rows', () => {
        const block = ANALYTICS.match(/export async function exportEmployeeReportExcel\([\s\S]*?\n}/)?.[0] || '';
        expect(block).toContain('await context.services.ensureAttendanceRange(');
        expect(block.indexOf('ensureAttendanceRange(')).toBeLessThan(block.indexOf('calculateEmployeeReportData('));
        expect(block).toContain('No se pudo cargar el período completo');
    });
});
