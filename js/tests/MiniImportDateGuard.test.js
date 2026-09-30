/**
 * Validación de fechas al importar desde Mini por niveles (pedido 2026-09-29).
 */
import {
    DATE_AGE_LEVEL,
    levelForDate,
    assessMiniImportDates,
    confirmMiniImportDates
} from '../modules/features/attendance/MiniImportDateGuard.js';

const TODAY = new Date('2026-09-29T10:00:00');

test('niveles: hasta 7 días nada, 8-30 informa, 31-90 confirma, más o futuro o otro año pide el año', () => {
    expect(levelForDate('2026-09-29', TODAY).level).toBe(DATE_AGE_LEVEL.OK);
    expect(levelForDate('2026-09-22', TODAY).level).toBe(DATE_AGE_LEVEL.OK);
    expect(levelForDate('2026-09-21', TODAY).level).toBe(DATE_AGE_LEVEL.INFO);
    expect(levelForDate('2026-08-30', TODAY).level).toBe(DATE_AGE_LEVEL.INFO);
    expect(levelForDate('2026-08-29', TODAY).level).toBe(DATE_AGE_LEVEL.CONFIRM);
    expect(levelForDate('2026-07-01', TODAY).level).toBe(DATE_AGE_LEVEL.CONFIRM);
    expect(levelForDate('2026-06-30', TODAY).level).toBe(DATE_AGE_LEVEL.STRONG);
    expect(levelForDate('2025-08-25', TODAY).level).toBe(DATE_AGE_LEVEL.STRONG); // caso real
    expect(levelForDate('2026-10-02', TODAY).level).toBe(DATE_AGE_LEVEL.STRONG); // futuro
    expect(levelForDate('2026-01-05', new Date('2026-02-10T10:00:00')).level).toBe(DATE_AGE_LEVEL.CONFIRM);
    expect(levelForDate('2025-12-20', new Date('2026-01-25T10:00:00')).level).toBe(DATE_AGE_LEVEL.STRONG); // otro año
});

test('el nivel del lote es el más alto y se detectan días anteriores al ingreso', () => {
    const employees = [{ id: 'e34', number: '34', name: 'Andres', hireDate: '2026-09-20' }];
    const result = assessMiniImportDates([
        { date: '2026-09-28', employeeIds: ['e34'] },
        { date: '2026-09-19', employeeIds: ['e34'] },
        { date: '2025-08-25', employeeIds: [] }
    ], { today: TODAY, employees });
    expect(result.level).toBe(DATE_AGE_LEVEL.STRONG);
    expect(result.confirmToken).toBe('2025');
    expect(result.hireIssues).toEqual([{ date: '2026-09-19', employeeId: 'e34', number: '34', name: 'Andres', hireDate: '2026-09-20' }]);
});

describe('confirmMiniImportDates', () => {
    const ui = () => ({ notify: jest.fn(), confirm: jest.fn(), strongConfirm: jest.fn() });

    test('reciente: aplica sin preguntar', async () => {
        const dialogs = ui();
        expect(await confirmMiniImportDates([{ date: '2026-09-28' }], { today: TODAY, ui: dialogs })).toBe(true);
        expect(dialogs.notify).not.toHaveBeenCalled();
        expect(dialogs.confirm).not.toHaveBeenCalled();
    });
    test('8-30 días: solo informa', async () => {
        const dialogs = ui();
        expect(await confirmMiniImportDates([{ date: '2026-09-10' }], { today: TODAY, ui: dialogs })).toBe(true);
        expect(dialogs.notify).toHaveBeenCalledWith(expect.stringContaining('hace 19 día(s)'), 'info');
        expect(dialogs.confirm).not.toHaveBeenCalled();
    });
    test('más de un mes: confirma y cancelar no aplica', async () => {
        const dialogs = ui();
        dialogs.confirm.mockResolvedValue(false);
        expect(await confirmMiniImportDates([{ date: '2026-08-01' }], { today: TODAY, ui: dialogs })).toBe(false);
        expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('más de un mes') }));
    });
    test('muy lejana: confirmación fuerte', async () => {
        const dialogs = ui();
        dialogs.strongConfirm.mockResolvedValue(true);
        expect(await confirmMiniImportDates([{ date: '2025-08-25' }], { today: TODAY, ui: dialogs })).toBe(true);
        expect(dialogs.strongConfirm).toHaveBeenCalledWith(expect.objectContaining({ assessment: expect.objectContaining({ confirmToken: '2025' }) }));
        expect(dialogs.confirm).not.toHaveBeenCalled();
    });
    test('día anterior al ingreso: se avisa aunque la fecha sea reciente', async () => {
        const dialogs = ui();
        const ok = await confirmMiniImportDates([{ date: '2026-09-28', employeeIds: ['e1'] }],
            { today: TODAY, employees: [{ id: 'e1', number: '34', name: 'Andres', hireDate: '2026-09-29' }], ui: dialogs });
        expect(ok).toBe(true);
        expect(dialogs.notify).toHaveBeenCalledWith(expect.stringContaining('anterior a su fecha de ingreso'), 'warning');
    });
});

test('el importador pasa por la validación en todos sus caminos de aplicar', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../modules/ui/modals/MiniAttendanceImportModal.js'), 'utf8');
    // Día por día (pegado y conectados) aplica en applyCurrentPlan; la vista
    // «Comparar con SA» aplica por día o los días listos.
    expect(src).toMatch(/guardMiniImportDates\(\[plan\.date\], \[plan\]\);\s*if \(gate !== true\) \{[\s\S]{0,120}if \(!\(await gate\)\) return null;/);
    expect(src).toMatch(/guardMiniImportDates\(\[group\.workDate\]\);\s*if \(gate !== true && !\(await gate\)\) return;\s*await this\.multiDayResolver\.applyDay/);
    expect(src).toMatch(/guardMiniImportDates\(readyDates\);\s*if \(gate !== true && !\(await gate\)\) return;\s*await this\.multiDayResolver\.applyReadyDays/);
    expect(src.match(/multiDayResolver\.apply(Day|ReadyDays)\(/g)).toHaveLength(2);
});
