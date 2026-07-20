import { createMirrorCadence, MIRROR_CADENCE_MS } from '../modules/services/MirrorCadence.js';

describe('MirrorCadence — trailing throttle de cinco minutos', () => {
    let now;
    let emit;
    let cadence;

    beforeEach(() => {
        jest.useFakeTimers();
        now = 1_000;
        emit = jest.fn().mockResolvedValue(undefined);
        cadence = createMirrorCadence({ emit, now: () => now });
    });

    afterEach(() => {
        cadence.discard();
        jest.useRealTimers();
    });

    test('el primer snapshot sale de inmediato', async () => {
        await cadence.offer({ revision: 1 });
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenLastCalledWith({ revision: 1 });
    });

    test('coalesce snapshots dentro de la ventana y emite sólo el último al vencer', async () => {
        await cadence.offer({ revision: 1 });
        now += 60_000;
        await cadence.offer({ revision: 2 });
        now += 60_000;
        await cadence.offer({ revision: 3 });

        expect(emit).toHaveBeenCalledTimes(1);
        now = 1_000 + MIRROR_CADENCE_MS;
        await jest.advanceTimersByTimeAsync(MIRROR_CADENCE_MS - 60_000);

        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith({ revision: 3 });
    });

    test('flush fuerza el último snapshot y cancela el timer trailing', async () => {
        await cadence.offer({ revision: 1 });
        now += 10_000;
        await cadence.offer({ revision: 2 });

        await cadence.flush();
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith({ revision: 2 });

        now += MIRROR_CADENCE_MS;
        await jest.runOnlyPendingTimersAsync();
        expect(emit).toHaveBeenCalledTimes(2);
    });

    test('discard elimina el trailing y reinicia la ventana para el próximo dataset', async () => {
        await cadence.offer({ revision: 1 });
        now += 10_000;
        await cadence.offer({ revision: 2 });
        cadence.discard();

        now += 1;
        await cadence.offer({ revision: 3 });
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith({ revision: 3 });
    });
});
