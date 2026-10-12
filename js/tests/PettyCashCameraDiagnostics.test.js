/**
 * Diagnóstico de la cámara de facturas: solo números (nunca imágenes ni datos
 * de las facturas), guardados en este teléfono para ajustar la cámara con uso
 * real: de dónde salió cada foto, cuánto tardó y pesó, cómo fue la guía de
 * factura larga, cómo salió la unión y qué avisos aparecieron o se corrigieron.
 */
import { createCameraDiagnostics, summarizeDiagnostics, DIAG_KEY } from '../modules/features/pettycash/PettyCashCameraDiagnostics.js';

const memoryStorage = () => {
    const data = new Map();
    return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
};

describe('createCameraDiagnostics', () => {
    test('guarda los eventos con la hora y los conserva al volver a abrir', () => {
        const storage = memoryStorage();
        let t = 1000;
        const diag = createCameraDiagnostics({ storage, now: () => t });
        diag.record('shot', { origin: 'sensor', grabMs: 150, saveMs: 800, kb: 420, mime: 'image/webp' });
        t = 2000;
        diag.record('fix', { code: 'itbis-rate', kind: 'apply' });
        const again = createCameraDiagnostics({ storage, now: () => t });
        expect(again.events()).toEqual([
            { t: 1000, type: 'shot', origin: 'sensor', grabMs: 150, saveMs: 800, kb: 420, mime: 'image/webp' },
            { t: 2000, type: 'fix', code: 'itbis-rate', kind: 'apply' }
        ]);
        expect(storage.data.has(DIAG_KEY)).toBe(true);
    });

    test('solo guarda los últimos N eventos', () => {
        const diag = createCameraDiagnostics({ storage: memoryStorage(), max: 3 });
        for (let i = 0; i < 5; i++) diag.record('fix', { code: `c${i}`, kind: 'accept' });
        expect(diag.events().map(e => e.code)).toEqual(['c2', 'c3', 'c4']);
    });

    test('sin almacenamiento disponible no falla (modo privado)', () => {
        const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
        const diag = createCameraDiagnostics({ storage: broken });
        expect(() => diag.record('fix', { code: 'x', kind: 'accept' })).not.toThrow();
        expect(diag.events()).toHaveLength(1);
        expect(() => diag.clear()).not.toThrow();
    });

    test('borrar deja el registro vacío; exportar da un texto con resumen y eventos', () => {
        const diag = createCameraDiagnostics({ storage: memoryStorage(), now: () => 5 });
        diag.record('shot', { origin: 'video', grabMs: 30, saveMs: 200, kb: 150, mime: 'image/jpeg' });
        const exported = JSON.parse(diag.exportText());
        expect(exported.summary.shots.count).toBe(1);
        expect(exported.events).toHaveLength(1);
        diag.clear();
        expect(diag.events()).toEqual([]);
    });
});

describe('summarizeDiagnostics', () => {
    const events = [
        { type: 'shot', origin: 'sensor', grabMs: 140, saveMs: 900, kb: 500, mime: 'image/webp' },
        { type: 'shot', origin: 'sensor', grabMs: 160, saveMs: 700, kb: 300, mime: 'image/webp' },
        { type: 'shot', origin: 'video', grabMs: 20, saveMs: 300, kb: 100, mime: 'image/jpeg' },
        { type: 'part', status: 'ok', ncc: 0.9, checks: 10, checkMs: 40, bestNcc: 0.95, msToOk: 3000, counts: { ok: 4, below: 6 } },
        { type: 'part', status: 'lost', ncc: 0.3, checks: 8, checkMs: 60, bestNcc: 0.4, msToOk: null, counts: { lost: 8 } },
        { type: 'stitch', parts: 3, found: 1, total: 2, ms: 400 },
        { type: 'result', state: 'review', codes: ['itbis-rate', 'ncf-format'] },
        { type: 'result', state: 'ok', codes: [] },
        { type: 'fix', code: 'itbis-rate', kind: 'accept' }
    ];

    test('fotos: de dónde salieron, tiempos y peso promedio', () => {
        const s = summarizeDiagnostics(events);
        expect(s.shots).toEqual({ count: 3, sensor: 2, video: 1, other: 0, avgGrabMs: 107, avgSaveMs: 633, avgKb: 300, webp: 2 });
    });

    test('factura larga: cuántas partes se tomaron con ✓, revisión en vivo y unión', () => {
        const s = summarizeDiagnostics(events);
        expect(s.parts).toEqual({ count: 2, withOk: 1, avgCheckMs: 49, avgBestNcc: 0.68, medianMsToOk: 3000, statusCounts: { ok: 4, below: 6, lost: 8 } });
        expect(s.stitches).toEqual({ count: 1, found: 1, total: 2, avgMs: 400 });
    });

    test('lectura y correcciones: estados y avisos más frecuentes', () => {
        const s = summarizeDiagnostics(events);
        expect(s.results).toEqual({ count: 2, states: { review: 1, ok: 1 }, codes: { 'itbis-rate': 1, 'ncf-format': 1 } });
        expect(s.fixes).toEqual({ count: 1, byCode: { 'itbis-rate:accept': 1 } });
    });

    test('sin eventos', () => {
        expect(summarizeDiagnostics([]).shots.count).toBe(0);
    });
});
