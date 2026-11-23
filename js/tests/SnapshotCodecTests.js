/**
 * 🧪 SnapshotCodecTests — snapshots grandes SIN Firebase Storage.
 *
 * Incidente 2026-07-11: el bucket de Storage nunca se aprovisionó (404 en
 * ambos nombres), así que TODO snapshot >800KB fallaba tras ~2 min de
 * reintentos y la "red de seguridad" nunca existió para este dataset. El
 * estado es JSON repetitivo: gzip lo baja ~10x, y en base64 entra cómodo en
 * un documento normal de Firestore (~1MB de límite).
 *
 * - Behavioral: gzipToBase64 / gunzipFromBase64 (módulo puro, usa
 *   CompressionStream — en jest se polyfillea desde node:stream/web).
 * - Contrato de fuente: createSnapshot comprime ANTES de intentar Storage;
 *   getSnapshot descomprime el encoding 'gzip-base64'.
 */

import fs from 'fs';
import path from 'path';
import {
    supportsGzipCodec, gzipToBase64, gunzipFromBase64,
    splitIntoChunks, joinChunks, chunkDocId
} from '../modules/services/SnapshotCodec.js';

const FB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);

// jsdom no trae los codecs de streams ni los codecs de texto/base64 —
// Node >=18 sí (node:stream/web, node:util, Buffer).
function ensureStreamPolyfills() {
    /* eslint-disable global-require */
    const web = require('node:stream/web');
    const util = require('node:util');
    if (typeof globalThis.CompressionStream === 'undefined') globalThis.CompressionStream = web.CompressionStream;
    if (typeof globalThis.DecompressionStream === 'undefined') globalThis.DecompressionStream = web.DecompressionStream;
    if (typeof globalThis.ReadableStream === 'undefined') globalThis.ReadableStream = web.ReadableStream;
    if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = util.TextEncoder;
    if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = util.TextDecoder;
    if (typeof globalThis.btoa === 'undefined') globalThis.btoa = (bin) => Buffer.from(bin, 'binary').toString('base64');
    if (typeof globalThis.atob === 'undefined') globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}

function buildBigStateString() {
    const employees = [];
    for (let i = 0; i < 300; i++) {
        employees.push({
            id: `emp-${i}`, name: `Empleado Nº ${i} — Ñandú`, positions: [`pos-${i % 7}`],
            positionSalaries: { [`pos-${i % 7}`]: 100 + i }, updatedAt: 1700000000000 + i
        });
    }
    return JSON.stringify({ employees, settings: { businessName: 'Construcción São Ñu' } });
}

testRunner.addSuite('SnapshotCodec — gzip+base64 ida y vuelta', {

    async 'round-trip: comprimir y descomprimir devuelve el string EXACTO (unicode incluido)'() {
        ensureStreamPolyfills();
        const original = buildBigStateString() + ' — tildes: áéíóú, emoji: 📦🛟';
        const b64 = await gzipToBase64(original);
        const back = await gunzipFromBase64(b64);
        testRunner.assertEquals(back, original, 'el round-trip debe ser sin pérdida');
    },

    async 'el JSON repetitivo del estado comprime MUY por debajo del umbral de Firestore'() {
        ensureStreamPolyfills();
        const original = buildBigStateString();
        const b64 = await gzipToBase64(original);
        testRunner.assert(b64.length < original.length / 2,
            `gzip+base64 debe reducir al menos a la mitad (${original.length} → ${b64.length})`);
    },

    'supportsGzipCodec detecta la disponibilidad de los streams'() {
        ensureStreamPolyfills();
        testRunner.assertEquals(supportsGzipCodec(), true,
            'con CompressionStream/DecompressionStream presentes debe dar true');
    }

});

testRunner.addSuite('Snapshots grandes — contrato: comprimir antes que Storage', {

    'createSnapshot intenta gzip ANTES de subir a Storage'() {
        const idx = FB_SRC.indexOf('async createSnapshot');
        testRunner.assert(idx !== -1, 'createSnapshot debe existir');
        const body = FB_SRC.slice(idx, idx + 5000);
        testRunner.assert(body.includes('gzipToBase64('),
            'el snapshot grande debe comprimirse (el bucket de Storage puede no existir)');
        const gzipIdx = body.indexOf('gzipToBase64(');
        const storageIdx = body.indexOf('uploadString(');
        testRunner.assert(storageIdx === -1 || gzipIdx < storageIdx,
            'la compresión va PRIMERO; Storage queda como último recurso');
        testRunner.assert(body.includes("'gzip-base64'"),
            'el doc debe declarar el encoding para que la lectura sepa decodificar');
    },

    'getSnapshot decodifica el encoding gzip-base64'() {
        const idx = FB_SRC.indexOf('async getSnapshot');
        testRunner.assert(idx !== -1, 'getSnapshot debe existir');
        const body = FB_SRC.slice(idx, idx + 2500);
        testRunner.assert(body.includes('gunzipFromBase64('),
            'el snapshot comprimido debe descomprimirse al leer');
    }

});

// Incidente 2026-11-16: un estado de ~16MB comprimía a >800KB, caía al
// bucket de Storage (no aprovisionado → preflight CORS fallido) y el backup
// automático moría tras ~2 min de reintentos. Ahora el base64 comprimido se
// reparte en documentos-trozo hermanos dentro de la misma colección.
testRunner.addSuite('Snapshots enormes — troceado en Firestore (sin Storage)', {

    'splitIntoChunks respeta el tamaño máximo y joinChunks reconstruye EXACTO'() {
        const original = 'abcdefghij'.repeat(1000) + 'XYZ';
        const parts = splitIntoChunks(original, 777);
        testRunner.assert(parts.length === Math.ceil(original.length / 777), 'número de trozos correcto');
        testRunner.assert(parts.every(p => p.length <= 777), 'ningún trozo excede el máximo');
        testRunner.assertEquals(joinChunks(parts), original, 'la unión debe ser sin pérdida');
    },

    'splitIntoChunks rechaza tamaños inválidos y maneja string vacío'() {
        let threw = false;
        try { splitIntoChunks('abc', 0); } catch (e) { threw = true; }
        testRunner.assert(threw, 'chunkSize 0 debe lanzar');
        testRunner.assertEquals(splitIntoChunks('', 10).length, 0, 'string vacío → sin trozos');
    },

    'joinChunks falla si falta un trozo (no restaurar datos corruptos)'() {
        let threw = false;
        try { joinChunks(['a', undefined, 'c']); } catch (e) { threw = true; }
        testRunner.assert(threw, 'un trozo faltante debe lanzar');
    },

    'chunkDocId es determinista y distinto del id del snapshot'() {
        testRunner.assertEquals(chunkDocId('snapshot_1', 0), 'snapshot_1__chunk_0');
        testRunner.assert(chunkDocId('snapshot_1', 1) !== 'snapshot_1', 'no debe pisar el doc principal');
    },

    async 'round-trip completo: gzip → trozos → unión → gunzip'() {
        ensureStreamPolyfills();
        const original = buildBigStateString();
        const b64 = await gzipToBase64(original);
        const parts = splitIntoChunks(b64, 1000);
        testRunner.assert(parts.length > 1, 'el ejemplo debe necesitar varios trozos');
        testRunner.assertEquals(await gunzipFromBase64(joinChunks(parts)), original);
    },

    'createSnapshot ya NO sube a Storage y usa el encoding troceado'() {
        const idx = FB_SRC.indexOf('async createSnapshot');
        const body = FB_SRC.slice(idx, idx + 6000);
        testRunner.assert(!body.includes('uploadString('),
            'el bucket de Storage no existe: subir ahí solo produce CORS + reintentos');
        testRunner.assert(body.includes("'gzip-base64-chunked'"), 'debe declarar el encoding troceado');
        testRunner.assert(body.includes('splitIntoChunks('), 'debe trocear el base64 grande');
    },

    'getSnapshot y deleteSnapshot entienden los trozos'() {
        const g = FB_SRC.indexOf('async getSnapshot');
        const gBody = FB_SRC.slice(g, g + 3500);
        testRunner.assert(gBody.includes("'gzip-base64-chunked'") && gBody.includes('joinChunks('),
            'getSnapshot debe reunir los trozos');
        const d = FB_SRC.indexOf('async deleteSnapshot(');
        const dBody = FB_SRC.slice(d, d + 2500);
        testRunner.assert(dBody.includes('chunkDocId('), 'deleteSnapshot debe borrar los trozos');
    }

});
