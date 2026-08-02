import { UndoManager } from '../modules/utils/UndoManager.js';

describe('UndoManager options', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
        UndoManager._pending = null;
        UndoManager._element = null;
    });

    afterEach(() => {
        UndoManager._dismiss();
        jest.useRealTimers();
    });

    test('honors a custom undo window and forwards critical save options', () => {
        const restoreFn = jest.fn();
        const saveFn = jest.fn();
        const renderFn = jest.fn();
        UndoManager.init({ saveFn, renderFn, showNotificationFn: jest.fn() });

        UndoManager.push(null, 'pagos de préstamos', restoreFn, {
            timeoutMs: 30_000,
            saveOptions: { immediate: true, announce: 'Pagos deshechos' }
        });
        jest.advanceTimersByTime(5_001);
        expect(UndoManager._pending).not.toBeNull();

        UndoManager.undo();
        expect(restoreFn).toHaveBeenCalledTimes(1);
        expect(saveFn).toHaveBeenCalledWith({ immediate: true, announce: 'Pagos deshechos' });
        expect(renderFn).toHaveBeenCalledTimes(1);
    });
});
