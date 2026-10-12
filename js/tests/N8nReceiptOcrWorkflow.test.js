/**
 * Flujo de n8n "Caja Chica - OCR" (infra/n8n/caja-chica-ocr.json).
 *
 * Corre el código real de cada nodo "Code" con entradas simuladas, para que
 * un cambio en el flujo no rompa lo que la app espera
 * (PettyCashReceiptOCR.normalizeReceiptOcr).
 */
import fs from 'fs';
import path from 'path';
import { normalizeReceiptOcr } from '../modules/features/pettycash/PettyCashReceiptOCR.js';

const workflow = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'infra/n8n/caja-chica-ocr.json'), 'utf8'));
const node = (name) => workflow.nodes.find(n => n.name === name);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runCode(name, json, { httpRequest = async () => ({ users: [{ localId: 'uid-1' }] }), env = {} } = {}) {
    const fn = new AsyncFunction('$input', '$env', node(name).parameters.jsCode);
    const out = await fn.call({ helpers: { httpRequest } }, { first: () => ({ json }) }, env);
    return out[0].json;
}
const gemini = (data) => ({ candidates: [{ content: { parts: [{ text: typeof data === 'string' ? data : JSON.stringify(data) }] } }] });

describe('Parsear JSON', () => {
    test('convierte la respuesta de Gemini en los campos que usa la app', async () => {
        const out = await runCode('Parsear JSON', gemini({
            emisor: 'Ferretería Ochoa', rnc_emisor: '101-01234-5', ncf: 'B0100000123', fecha: '2026-10-01',
            subtotal: '1,000.00', itbis: '180', total: 1180, categoria: 'Materiales',
            items: [{ nombre: 'Cemento', cantidad: '2', precio: '1,000' }]
        }));
        expect(out).toMatchObject({ ok: true, emisor: 'Ferretería Ochoa', rncEmisor: '101-01234-5', ncf: 'B0100000123', subtotal: 1000, itbis: 180, total: 1180 });
        expect(out.items).toEqual([{ descripcion: 'Cemento', cantidad: 2, precio: 1000 }]);
    });

    test('quita bloques ```json``` y responde ok:false si no es JSON', async () => {
        expect((await runCode('Parsear JSON', gemini('```json\n{"total": 5}\n```'))).total).toBe(5);
        const bad = await runCode('Parsear JSON', gemini('no es json'));
        expect(bad.ok).toBe(false);
        expect(bad.raw).toBe('no es json');
    });
});

describe('Parsear JSON: recuadros (boxes)', () => {
    test('pasa los recuadros a la app con sus nombres y la app los guarda', async () => {
        const out = await runCode('Parsear JSON', gemini({
            total: 1180, ncf: 'B0100000123', fecha: '2026-10-01',
            boxes: { total: [880, 600, 910, 900], ncf: [120.4, 500, 140, 880], rnc_emisor: [90, 100, 110, 400], fecha: [150, 600, 170, 880], itbis: null }
        }));
        expect(out.boxes).toEqual({ total: [880, 600, 910, 900], ncf: [120, 500, 140, 880], rncEmisor: [90, 100, 110, 400], fecha: [150, 600, 170, 880] });
        const app = normalizeReceiptOcr(out);
        expect(app.fiscal.boxes).toEqual({ total: [880, 600, 910, 900], ncf: [120, 500, 140, 880], rncEmisor: [90, 100, 110, 400], date: [150, 600, 170, 880] });
    });

    test('descarta recuadros mal formados; sin recuadros queda null', async () => {
        const out = await runCode('Parsear JSON', gemini({
            total: 5,
            boxes: { total: [10, 20, 5, 40], subtotal: [0, 0, 2000, 10], itbis: [1, 2, 3], ncf: ['a', 1, 2, 3], fecha: [10, 10, 20, 20] }
        }));
        expect(out.boxes).toEqual({ fecha: [10, 10, 20, 20] });
        expect((await runCode('Parsear JSON', gemini({ total: 5 }))).boxes).toBeNull();
        expect((await runCode('Parsear JSON', gemini({ total: 5, boxes: null }))).boxes).toBeNull();
    });
});

describe('Verificar idToken', () => {
    const body = { fileBase64: 'AAAA', mimeType: 'image/webp', idToken: 'tok' };

    test('acepta un token válido y rechaza faltantes o inválidos', async () => {
        const out = await runCode('Verificar idToken', { body, headers: {} });
        expect(out._uid).toBe('uid-1');
        await expect(runCode('Verificar idToken', { body: { ...body, idToken: '' }, headers: {} })).rejects.toThrow('Falta idToken');
        await expect(runCode('Verificar idToken', { body, headers: {} }, { httpRequest: async () => ({}) })).rejects.toThrow('idToken invalido');
        await expect(runCode('Verificar idToken', { body: { ...body, mimeType: 'text/html' }, headers: {} })).rejects.toThrow('no compatible');
    });

    test('solo la app y pruebas locales pueden llamar desde el navegador', async () => {
        for (const origin of ['https://sistema-de-asistencia.pages.dev', 'https://claude-epic-curie-ps0wn3.sistema-de-asistencia.pages.dev', 'http://localhost:8765']) {
            expect((await runCode('Verificar idToken', { body, headers: { origin } }))._uid).toBe('uid-1');
        }
        for (const origin of ['https://evil.example', 'https://sistema-de-asistencia.pages.dev.evil.example', 'http://sistema-de-asistencia.pages.dev']) {
            await expect(runCode('Verificar idToken', { body, headers: { origin } })).rejects.toThrow('Origen no permitido');
        }
    });

    test('usa FIREBASE_WEB_API_KEY si n8n la permite; si está bloqueada, la clave de la app', async () => {
        const urls = [];
        const httpRequest = async (req) => { urls.push(req.url); return { users: [{ localId: 'u' }] }; };
        await runCode('Verificar idToken', { body, headers: {} }, { httpRequest, env: { FIREBASE_WEB_API_KEY: 'k-env' } });
        const blocked = new Proxy({}, { get() { throw new Error('access to env vars denied'); } });
        await runCode('Verificar idToken', { body, headers: {} }, { httpRequest, env: blocked });
        expect(urls[0]).toMatch(/key=k-env$/);
        expect(urls[1]).toMatch(/key=AIza/);
    });
});

describe('Preparar solicitud Gemini', () => {
    test('separa el data URL y envía la imagen con su tipo', async () => {
        const out = await runCode('Preparar solicitud Gemini', { body: { fileBase64: 'data:image/webp;base64,QUJD' } });
        const parts = out.geminiBody.contents[0].parts;
        expect(parts[1].inlineData).toEqual({ mimeType: 'image/webp', data: 'QUJD' });
        expect(out.geminiBody.generationConfig.responseMimeType).toBe('application/json');
    });

    test('pide los recuadros de cada dato y deja espacio para la respuesta', async () => {
        const out = await runCode('Preparar solicitud Gemini', { body: { fileBase64: 'QUJD', mimeType: 'image/jpeg' } });
        const prompt = out.geminiBody.contents[0].parts[0].text;
        expect(prompt).toMatch(/"boxes"/);
        expect(prompt).toMatch(/\[y_min, x_min, y_max, x_max\]/);
        ['"total"', '"ncf"', '"rnc_emisor"', '"fecha"', '"itbis"', '"subtotal"'].forEach(k => expect(prompt).toContain(k));
        expect(out.geminiBody.generationConfig.maxOutputTokens).toBe(4096);
    });
});
