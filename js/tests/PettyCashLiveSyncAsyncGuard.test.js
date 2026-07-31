import { PettyCashLiveSync } from '../modules/services/PettyCashLiveSync.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('PettyCashLiveSync — guard asíncrono', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        PettyCashLiveSync.stop();
        window._isApplyingRemoteData = false;
    });

    afterEach(() => {
        PettyCashLiveSync.stop();
        jest.useRealTimers();
    });

    test('mantiene el guard hasta que termina la aplicación remota', async () => {
        const pending = deferred();
        let receive;
        PettyCashLiveSync.start({
            movements: {
                subscribe: (callback) => {
                    receive = callback;
                    return () => {};
                },
                onApply: () => pending.promise
            }
        });

        const applying = receive([{ id: 'm1' }]);
        expect(window._isApplyingRemoteData).toBe(true);
        jest.advanceTimersByTime(1000);
        expect(window._isApplyingRemoteData).toBe(true);

        pending.resolve();
        await applying;
        expect(window._isApplyingRemoteData).toBe(true);
        jest.advanceTimersByTime(500);
        expect(window._isApplyingRemoteData).toBe(false);
    });

    test('un snapshot anterior no libera el guard de otro todavía activo', async () => {
        const first = deferred();
        const second = deferred();
        const pending = [first, second];
        let receive;
        PettyCashLiveSync.start({
            movements: {
                subscribe: (callback) => {
                    receive = callback;
                    return () => {};
                },
                onApply: () => pending.shift().promise
            }
        });

        const firstApply = receive([{ id: 'm1' }]);
        const secondApply = receive([{ id: 'm2' }]);
        first.resolve();
        await firstApply;
        jest.advanceTimersByTime(500);
        expect(window._isApplyingRemoteData).toBe(true);

        second.resolve();
        await secondApply;
        jest.advanceTimersByTime(500);
        expect(window._isApplyingRemoteData).toBe(false);
    });
});
