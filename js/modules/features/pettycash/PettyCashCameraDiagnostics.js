/**
 * Diagnóstico de la cámara de facturas (Configuración → Tests).
 *
 * Guarda en este teléfono solo números, nunca imágenes ni datos de las
 * facturas, para ajustar la cámara con uso real:
 *   shot   → de dónde salió la foto (sensor/video), cuánto tardó y pesó;
 *   part   → factura larga: qué decía la guía al tomar cada parte, cuánto
 *            tardó cada revisión en vivo y la mejor coincidencia vista;
 *   stitch → unión: cuántos traslapes se encontraron y cuánto tardó;
 *   result → lectura: estado final y avisos que aparecieron;
 *   fix    → qué avisos se corrigieron desde la vista previa y cómo.
 *
 * Probado en js/tests/PettyCashCameraDiagnostics.test.js.
 */

export const DIAG_KEY = 'sa.pcam.diag.v1';
export const DIAG_MAX = 400;

const safeStorage = () => {
    try { return globalThis.localStorage || null; } catch (_) { return null; }
};

const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (n, digits = 0) => { const k = 10 ** digits; return Math.round(n * k) / k; };
const median = (values) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const tally = (into, key, n = 1) => { into[key] = (into[key] || 0) + n; return into; };

export function summarizeDiagnostics(events = []) {
    const of = (type) => events.filter(e => e.type === type);
    const shots = of('shot');
    const parts = of('part');
    const stitches = of('stitch');
    const results = of('result');
    const fixes = of('fix');
    const totalChecks = parts.reduce((a, p) => a + (p.checks || 0), 0);
    return {
        shots: {
            count: shots.length,
            sensor: shots.filter(s => s.origin === 'sensor').length,
            video: shots.filter(s => s.origin === 'video').length,
            other: shots.filter(s => s.origin !== 'sensor' && s.origin !== 'video').length,
            avgGrabMs: round(avg(shots.map(s => s.grabMs || 0))),
            avgSaveMs: round(avg(shots.map(s => s.saveMs || 0))),
            avgKb: round(avg(shots.map(s => s.kb || 0))),
            webp: shots.filter(s => s.mime === 'image/webp').length
        },
        parts: {
            count: parts.length,
            withOk: parts.filter(p => p.status === 'ok').length,
            avgCheckMs: totalChecks ? round(parts.reduce((a, p) => a + (p.checkMs || 0) * (p.checks || 0), 0) / totalChecks) : 0,
            avgBestNcc: round(avg(parts.map(p => p.bestNcc ?? 0)), 2),
            medianMsToOk: median(parts.map(p => p.msToOk).filter(v => Number.isFinite(v))),
            statusCounts: parts.reduce((acc, p) => { Object.entries(p.counts || {}).forEach(([k, n]) => tally(acc, k, n)); return acc; }, {})
        },
        stitches: {
            count: stitches.length,
            found: stitches.reduce((a, s) => a + (s.found || 0), 0),
            total: stitches.reduce((a, s) => a + (s.total || 0), 0),
            avgMs: round(avg(stitches.map(s => s.ms || 0)))
        },
        results: {
            count: results.length,
            states: results.reduce((acc, r) => tally(acc, r.state), {}),
            codes: results.reduce((acc, r) => { (r.codes || []).forEach(c => tally(acc, c)); return acc; }, {})
        },
        fixes: {
            count: fixes.length,
            byCode: fixes.reduce((acc, f) => tally(acc, `${f.code}:${f.kind}`), {})
        }
    };
}

export function createCameraDiagnostics({ storage = safeStorage(), now = () => Date.now(), max = DIAG_MAX } = {}) {
    let list = [];
    try {
        const raw = storage?.getItem(DIAG_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) list = parsed;
    } catch (_) { list = []; }

    const save = () => {
        try { storage?.setItem(DIAG_KEY, JSON.stringify(list)); } catch (_) { /* sin espacio o modo privado */ }
    };

    return {
        record(type, data = {}) {
            list.push({ t: now(), type, ...data });
            if (list.length > max) list = list.slice(list.length - max);
            save();
        },
        events: () => list.slice(),
        summary: () => summarizeDiagnostics(list),
        clear() {
            list = [];
            try { storage?.removeItem(DIAG_KEY); } catch (_) { /* nada que borrar */ }
        },
        exportText() {
            return JSON.stringify({ app: 'sistema-de-asistencia', diag: 'camara-facturas', v: 1, exportedAt: new Date(now()).toISOString(), summary: summarizeDiagnostics(list), events: list }, null, 1);
        }
    };
}
