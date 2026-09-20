import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * F1 ronda-02 — contratos congelados por Validación sobre main 770c390.
 * Cubren aislamiento multiproyecto, FULL import y contexto visual de obra activa.
 */
describe('F1 R02 — isolation, FULL import and active-project UX', () => {
    test('Analytics/reportes aplican frontera project-aware antes de construir reportData', () => {
        const src = read('modules/features/analytics/AnalyticsUI.js');
        const start = src.indexOf('function calculateEmployeeReportData()');
        const end = src.indexOf('// ✅ wasEmployeeActiveInRange');
        const body = src.slice(start, end > start ? end : start + 15000);
        expect(body).toMatch(/entityInScope|filterEntitiesInScope|getScoped|project.*scope/i);
        expect(body).not.toMatch(/employees:\s*state\.employees\s*,[\s\S]*attendance:\s*state\.attendance\s*,/);
    });

    test('Notes Center contiene frontera project-aware para empleados/asistencia', () => {
        const src = read('modules/features/notes/NotesCenter.js');
        expect(src).toMatch(/entityInScope|filterEntitiesInScope|getScoped|project.*scope/i);
    });

    test('EmployeeFloatingCard valida alcance antes de resolver empleado global', () => {
        const src = read('modules/ui/components/EmployeeFloatingCard.js');
        expect(src).toMatch(/entityInScope|effectiveProjectId|sameEffectiveProject|getScoped|project.*scope/i);
    });

    test('EmployeeProfileModal valida alcance del empleado seleccionado', () => {
        const src = read('modules/features/profile/EmployeeProfileModal.js');
        expect(src).toMatch(/entityInScope|effectiveProjectId|sameEffectiveProject|getScoped|project.*scope/i);
    });

    test('detalle de asistencia no resuelve desde state global sin guardia de scope', () => {
        const src = read('app.js');
        const start = src.indexOf('function _AttendanceDetailPanelInner()');
        const end = src.indexOf('function AttendanceDayView');
        const body = src.slice(start, end > start ? end : start + 14000);
        expect(body).toMatch(/entityInScope|effectiveProjectId|sameEffectiveProject|getScoped|project.*scope/i);
    });

    test('FULL import restaura de forma esperada y explícita pettyCash + metadata de proyectos', () => {
        const src = read('modules/features/export/ExportController.js');
        const start = src.indexOf('function applyFullImport(importedData)');
        const asyncStart = src.indexOf('async function applyFullImport(importedData)');
        const actualStart = asyncStart >= 0 ? asyncStart : start;
        const end = src.indexOf('export function confirmImportFull()', actualStart);
        const body = src.slice(actualStart, end);
        expect(asyncStart).toBeGreaterThanOrEqual(0);
        expect(body).toMatch(/pettyCash/);
        expect(body).toMatch(/projects|projectBackup|projectPayrollConfigs/);
        expect(body).toMatch(/await\s+/);
        expect(body).toMatch(/clearFirst\s*:\s*true|applyBackupData|saveToIndexedDB/);
        const reloadAt = body.search(/location\.reload|reload\s*\(/);
        const awaitAt = body.search(/await\s+/);
        if (reloadAt >= 0) expect(awaitAt).toBeLessThan(reloadAt);
    });

    test('header muestra persistentemente la obra activa fuera de Configuración', () => {
        const header = read('modules/ui/Header.js');
        const app = read('app.js');
        expect(header).toMatch(/activeProjectName|projectName/);
        expect(header).toMatch(/data-active-project-indicator/);
        const start = app.indexOf('Header({');
        const wiring = app.slice(start, start + 1200);
        expect(wiring).toMatch(/activeProjectName|projectName/);
    });
});
