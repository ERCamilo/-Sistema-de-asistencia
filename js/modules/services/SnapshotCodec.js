/**
 * 📦 SnapshotCodec.js — snapshots grandes SIN Firebase Storage.
 *
 * Incidente 2026-07-11: el bucket de Storage nunca se aprovisionó, así que
 * todo snapshot >800KB fallaba tras ~2 min de reintentos del SDK y la "red
 * de seguridad" no existía para este dataset. El estado es JSON repetitivo:
 * gzip lo reduce ~10x y, aun con el +33% de base64, entra cómodo en un
 * documento normal de Firestore (límite ~1MB).
 *
 * Puro y sin dependencias: usa los codecs nativos del navegador
 * (CompressionStream / DecompressionStream, disponibles en todos los
 * navegadores modernos). Si faltan, supportsGzipCodec() devuelve false y el
 * caller decide su fallback (Storage o error honesto).
 */

export function supportsGzipCodec() {
    return typeof CompressionStream !== 'undefined' &&
        typeof DecompressionStream !== 'undefined' &&
        typeof ReadableStream !== 'undefined' &&
        typeof TextEncoder !== 'undefined';
}

async function _pipeBytes(bytes, transform) {
    const source = new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        }
    });
    const reader = source.pipeThrough(transform).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

// btoa/atob trabajan sobre "binary strings"; el paso por bloques evita
// reventar el límite de argumentos de String.fromCharCode con buffers
// grandes.
function _bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

function _base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Comprime un string (UTF-8) con gzip y lo devuelve como base64. */
export async function gzipToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    const gzipped = await _pipeBytes(bytes, new CompressionStream('gzip'));
    return _bytesToBase64(gzipped);
}

/** Inversa exacta de gzipToBase64. */
export async function gunzipFromBase64(b64) {
    const gzipped = _base64ToBytes(b64);
    const bytes = await _pipeBytes(gzipped, new DecompressionStream('gzip'));
    return new TextDecoder().decode(bytes);
}

export default { supportsGzipCodec, gzipToBase64, gunzipFromBase64 };
