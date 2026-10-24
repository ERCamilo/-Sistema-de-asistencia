import { loadWeeklyPositionHandler } from './helpers/weeklyPositionHandler.js';

describe('weekly position selection writes the actual job, not only its label', () => {
    test.each([
        [false, [{ positionId: 'rebar', hours: 8, overtimeHours: 2 }]],
        [true, [{ positionId: 'rebar', hours: 8 }]],
        [true, [{ positionId: 'rebar', hours: 4, overtimeHours: 1 }, { positionId: 'masonry', hours: 4, overtimeHours: 1 }]]
    ])('replaces an old allocation (multi-position: %s) and saves the edited date', (multiPosition, positionHours) => {
        const key = 'e-2026-10-21';
        const record = { employeeId: 'e', date: '2026-10-21', present: true, hoursWorked: 8,
            overtimeHours: 2, selectedPosition: 'rebar', multiPosition, positionHours,
            notes: 'Keep note', isHoliday: true, projectId: 'P', updatedAt: 1,
            miniImportAudit: { source: 'mini' } };
        const state = { selectedDate: '2026-10-24', employees: [{ id: 'e' }], attendance: { [key]: record } };
        const handler = loadWeeklyPositionHandler(state);
        handler.change('e', 'masonry', '2026-10-21');
        expect(state.attendance[key]).toMatchObject({ selectedPosition: 'masonry', multiPosition: false,
            positionHours: [], hoursWorked: 8, overtimeHours: 2, isHoliday: true, notes: 'Keep note',
            projectId: 'P', miniImportAudit: { source: 'mini' }, deletedAt: null });
        expect(record.updatedAt).toBeGreaterThan(1);
        expect(handler.invalidateEmployeeStats).toHaveBeenCalledWith('e');
        expect(handler.buildAttendanceIndex).toHaveBeenCalledWith('2026-10-21');
        expect(handler.componentMemo.invalidate).toHaveBeenCalledWith('week-row-e');
        expect(handler.saveApplicationData).toHaveBeenCalledWith({ dateKey: '2026-10-21', announce: 'Posición actualizada' });
        expect(handler.render).toHaveBeenCalledTimes(1);
    });

    test('selecting the same visible position repairs a previously inconsistent single allocation', () => {
        const state = { employees: [{ id: 'e' }], attendance: { 'e-2026-10-22': {
            present: true, hoursWorked: 8, selectedPosition: 'masonry', multiPosition: true,
            positionHours: [{ positionId: 'rebar', hours: 8 }]
        } } };
        loadWeeklyPositionHandler(state).change('e', 'masonry', '2026-10-22');
        expect(state.attendance['e-2026-10-22']).toMatchObject({ selectedPosition: 'masonry', multiPosition: false, positionHours: [] });
    });

    test.each([undefined, { present: false }, { present: true, deletedAt: 123 }])('does not edit an absent, deleted or missing day: %p', record => {
        const state = { employees: [{ id: 'e' }], attendance: { 'e-2026-10-21': record } };
        const before = JSON.stringify(state);
        const handler = loadWeeklyPositionHandler(state);
        handler.change('e', 'masonry', '2026-10-21');
        expect(JSON.stringify(state)).toBe(before);
        expect(handler.saveApplicationData).not.toHaveBeenCalled();
    });
});
