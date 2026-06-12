/**
 * 🧪 HeadersFileTests (hardening 2026-06-12)
 *
 * Cloudflare Pages serves a `_headers` file at the repo root to attach
 * security headers to every response. Without it the app ships no
 * X-Frame-Options (clickjacking), no X-Content-Type-Options (MIME sniffing),
 * a permissive Referrer-Policy, and an open Permissions-Policy.
 *
 * Fix: version a `_headers` file with a default-deny security posture and
 * keep it under test so it can never silently disappear or drift.
 *
 * Note: camera/microphone/geolocation are denied today because the app uses
 * none of them. When the in-app camera (getUserMedia) lands, relax camera to
 * `camera=(self)` here and the assertion below will guard the change.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => {
    try { return fs.readFileSync(path.resolve(ROOT, rel), 'utf8'); } catch { return null; }
};

testRunner.addSuite("Security headers — _headers en Cloudflare Pages", {

    "existe _headers en la raíz del repo"() {
        const src = read('_headers');
        testRunner.assert(!!src, 'debe existir _headers versionado en la raíz del repo');
    },

    "aplica a todas las rutas con el glob /*"() {
        const src = read('_headers') || '';
        testRunner.assert(/^\s*\/\*\s*$/m.test(src),
            'debe haber una sección /* que cubra todas las respuestas');
    },

    "niega framing y MIME sniffing"() {
        const src = read('_headers') || '';
        testRunner.assert(/X-Frame-Options:\s*DENY/i.test(src),
            'X-Frame-Options: DENY contra clickjacking');
        testRunner.assert(/X-Content-Type-Options:\s*nosniff/i.test(src),
            'X-Content-Type-Options: nosniff contra MIME sniffing');
    },

    "fija una Referrer-Policy estricta"() {
        const src = read('_headers') || '';
        testRunner.assert(/Referrer-Policy:\s*strict-origin-when-cross-origin/i.test(src),
            'Referrer-Policy: strict-origin-when-cross-origin');
    },

    "restringe Permissions-Policy (cámara, micrófono, geolocalización)"() {
        const src = read('_headers') || '';
        testRunner.assert(/Permissions-Policy:/i.test(src),
            'debe declarar una Permissions-Policy');
        testRunner.assert(/camera=\(\)/i.test(src), 'camera deshabilitada por defecto');
        testRunner.assert(/microphone=\(\)/i.test(src), 'microphone deshabilitada por defecto');
        testRunner.assert(/geolocation=\(\)/i.test(src), 'geolocation deshabilitada por defecto');
    }

});
