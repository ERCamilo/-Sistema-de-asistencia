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

    test('honors a custom undo window and forwards critical save options', async () => {
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

        await UndoManager.undo();
        expect(restoreFn).toHaveBeenCalledTimes(1);
        expect(saveFn).toHaveBeenCalledWith({ immediate: true, announce: 'Pagos deshechos' });
        expect(renderFn).toHaveBeenCalledTimes(1);
    });

    test('awaits async persistence before rendering or announcing success', async () => {
        let resolveSave;
        const saveFn = jest.fn(() => new Promise(resolve => { resolveSave = resolve; }));
        const renderFn = jest.fn();
        const showNotificationFn = jest.fn();
        UndoManager.init({ saveFn, renderFn, showNotificationFn });
        UndoManager.push(null, 'pagos', jest.fn());

        const pending = UndoManager.undo();
        expect(renderFn).not.toHaveBeenCalled();
        expect(showNotificationFn).not.toHaveBeenCalled();
        await Promise.resolve();
        resolveSave();
        await pending;

        expect(renderFn).toHaveBeenCalledTimes(1);
        expect(showNotificationFn).toHaveBeenCalledWith('↩️ Deshecho: pagos', 'info');
    });

    test('does not render or announce success when async persistence rejects', async () => {
        const error = new Error('save failed');
        const renderFn = jest.fn();
        const showNotificationFn = jest.fn();
        UndoManager.init({ saveFn: jest.fn().mockRejectedValue(error), renderFn, showNotificationFn });
        UndoManager.push(null, 'pagos', jest.fn());

        await expect(UndoManager.undo()).rejects.toBe(error);
        expect(renderFn).not.toHaveBeenCalled();
        expect(showNotificationFn).not.toHaveBeenCalled();
    });
});
