import { createMirrorCadence, MIRROR_CADENCE_MS, getMirrorCadenceMs, MIRROR_CADENCE_PRESETS } from '../modules/services/MirrorCadence.js';

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

    test('getMirrorCadenceMs resuelve presets correctamente', () => {
        expect(getMirrorCadenceMs('1m')).toBe(60_000);
        expect(getMirrorCadenceMs('5m')).toBe(300_000);
        expect(getMirrorCadenceMs('15m')).toBe(900_000);
        expect(getMirrorCadenceMs('manual')).toBe(Infinity);
        expect(getMirrorCadenceMs(undefined)).toBe(MIRROR_CADENCE_MS);
        expect(getMirrorCadenceMs(120_000)).toBe(120_000);
    });

    test('intervalMs dinámico por función adapta la cadencia en tiempo de ejecución', async () => {
        let currentSetting = '1m';
        const dynamicCadence = createMirrorCadence({
            emit,
            now: () => now,
            intervalMs: () => getMirrorCadenceMs(currentSetting)
        });

        await dynamicCadence.offer({ revision: 1 });
        expect(emit).toHaveBeenCalledTimes(1);

        now += 30_000;
        await dynamicCadence.offer({ revision: 2 });
        expect(emit).toHaveBeenCalledTimes(1);

        now += 30_000;
        await jest.advanceTimersByTimeAsync(30_000);
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith({ revision: 2 });

        dynamicCadence.discard();
    });

    test('modo manual no programa temporizador trailing automático', async () => {
        const manualCadence = createMirrorCadence({
            emit,
            now: () => now,
            intervalMs: Infinity
        });

        await manualCadence.offer({ revision: 1 });
        expect(emit).toHaveBeenCalledTimes(1);

        now += 100_000;
        await manualCadence.offer({ revision: 2 });
        expect(emit).toHaveBeenCalledTimes(1);

        now += 10_000_000;
        await jest.advanceTimersByTimeAsync(10_000_000);
        expect(emit).toHaveBeenCalledTimes(1); // nunca emite automáticamente

        await manualCadence.flush();
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith({ revision: 2 });

        manualCadence.discard();
    });

    test('preset instant (0ms) emite cada snapshot inmediatamente sin coalescer', async () => {
        expect(getMirrorCadenceMs('instant')).toBe(0);
        const instantCadence = createMirrorCadence({
            emit,
            now: () => now,
            intervalMs: 0
        });

        await instantCadence.offer({ revision: 1 });
        expect(emit).toHaveBeenCalledTimes(1);

        now += 500;
        await instantCadence.offer({ revision: 2 });
        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith({ revision: 2 });

        now += 500;
        await instantCadence.offer({ revision: 3 });
        expect(emit).toHaveBeenCalledTimes(3);
        expect(emit).toHaveBeenLastCalledWith({ revision: 3 });

        instantCadence.discard();
    });
});
