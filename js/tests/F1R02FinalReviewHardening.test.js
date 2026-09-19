const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function functionBody(src, marker, nextMarker, max = 12000) {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const end = src.indexOf(nextMarker, start + marker.length);
    return src.slice(start, end > start ? end : start + max);
}

describe('F1 R02 — final independent-review hardening', () => {
    test('Resumen General uses project-scoped attendance totals', () => {
        const src = read('modules/features/analytics/AnalyticsUI.js');
        const body = functionBody(src, 'function EmployeeReportGeneralSection', 'function EmployeeReportPositionSection');
        expect(body).toMatch(/getScopedAnalytics|scoped\.attendance|scopedAttendance/);
        expect(body).not.toMatch(/state\.attendance\s*\[/);
    });

    test('attendance selected-row helper resolves only employees in active project scope', () => {
        const src = read('modules/ui/AttendanceUI.js');
        const body = functionBody(src, 'export function getEffectiveAttendanceDetailEmployeeId', 'export function getAttendanceWatermarkPositions', 3500);
        expect(body).toMatch(/entityInScope/);
        expect(body).toMatch(/peekEntityScope/);
    });
});
