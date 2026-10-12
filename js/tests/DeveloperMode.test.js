/**
 * Modo desarrollador: tocar 7 veces la versión muestra (u oculta) la
 * pestaña Tests. Se guarda solo en este teléfono.
 */
import { createVersionTapper, isDeveloperMode, setDeveloperMode, versionTapMessage, DEV_MODE_KEY } from '../modules/ui/settings/DeveloperMode.js';

const memoryStorage = () => {
    const data = new Map();
    return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
};

describe('createVersionTapper', () => {
    test('7 toques seguidos activan; otros 7 desactivan', () => {
        const storage = memoryStorage();
        let t = 0;
        const tapper = createVersionTapper({ storage, now: () => t });
        const results = [];
        for (let i = 0; i < 7; i++) { t += 300; results.push(tapper.tap()); }
        expect(results.slice(0, 6).map(r => r.remaining)).toEqual([6, 5, 4, 3, 2, 1]);
        expect(results[6]).toEqual({ state: 'on' });
        expect(isDeveloperMode(storage)).toBe(true);
        expect(storage.data.get(DEV_MODE_KEY)).toBe('1');

        for (let i = 0; i < 6; i++) { t += 300; expect(tapper.tap().enabling).toBe(false); }
        t += 300;
        expect(tapper.tap()).toEqual({ state: 'off' });
        expect(isDeveloperMode(storage)).toBe(false);
    });

    test('una pausa larga reinicia la cuenta', () => {
        const storage = memoryStorage();
        let t = 0;
        const tapper = createVersionTapper({ storage, now: () => t });
        for (let i = 0; i < 5; i++) { t += 300; tapper.tap(); }
        t += 5000;
        expect(tapper.tap().remaining).toBe(6);
        expect(isDeveloperMode(storage)).toBe(false);
    });

    test('sin almacenamiento (modo privado) no falla y queda apagado', () => {
        const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
        let t = 0;
        const tapper = createVersionTapper({ storage: broken, now: () => t });
        let last;
        for (let i = 0; i < 7; i++) { t += 100; last = tapper.tap(); }
        expect(last).toEqual({ state: 'off' });
        expect(() => setDeveloperMode(true, broken)).not.toThrow();
    });
});

describe('versionTapMessage', () => {
    test('calla en los primeros toques y avisa al acercarse', () => {
        expect(versionTapMessage({ state: 'counting', remaining: 6, enabling: true })).toBeNull();
        expect(versionTapMessage({ state: 'counting', remaining: 3, enabling: true }).text).toBe('Faltan 3 toques para activar el modo desarrollador.');
        expect(versionTapMessage({ state: 'counting', remaining: 1, enabling: false }).text).toBe('Falta 1 toque para desactivar el modo desarrollador.');
        expect(versionTapMessage({ state: 'on' }).type).toBe('success');
        expect(versionTapMessage({ state: 'off' }).text).toMatch(/oculta/);
    });
});
