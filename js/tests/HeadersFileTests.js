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

/**
 * Content-Security-Policy (hardening 2026-06-14).
 *
 * Shipped Report-Only first so it cannot break Google sign-in / weather / the
 * OCR webhook / CDN assets in production. These assertions accept BOTH header
 * names — `Content-Security-Policy-Report-Only` (today) and
 * `Content-Security-Policy` (after promotion) — so flipping to enforcement
 * keeps the suite green. The allowlist is grounded in the external hosts the
 * app actually calls (Firebase, Google auth, weatherapi, n8n, the Supabase
 * petty-cash mirror, the Cloudflare Web Analytics beacon, the icon/Excel
 * CDNs and avatar service).
 */
// Pulls the CSP directive string from _headers regardless of whether it is
// shipped Report-Only (today) or enforcing (after promotion).
const readCsp = () => {
    const src = read('_headers') || '';
    const m = src.match(/Content-Security-Policy(?:-Report-Only)?:\s*(.+)/i);
    return m ? m[1] : '';
};

testRunner.addSuite("Security headers — Content-Security-Policy", {

    "declara una CSP (report-only o enforcing)"() {
        testRunner.assert(!!readCsp(), 'debe existir una cabecera Content-Security-Policy[-Report-Only]');
    },

    "fija un default-src restrictivo a 'self'"() {
        testRunner.assert(/default-src\s+'self'/i.test(readCsp()),
            "default-src 'self' como base por defecto");
    },

    "bloquea plugins, base-uri y framing externo"() {
        const csp = readCsp();
        testRunner.assert(/object-src\s+'none'/i.test(csp), "object-src 'none' (sin Flash/applets)");
        testRunner.assert(/base-uri\s+'self'/i.test(csp), "base-uri 'self' (anti base-tag hijack)");
        testRunner.assert(/frame-ancestors\s+'none'/i.test(csp), "frame-ancestors 'none' (anti-clickjacking)");
    },

    "permite los orígenes de Firebase y los CDNs de scripts"() {
        const csp = readCsp();
        testRunner.assert(/script-src[^;]*gstatic\.com/i.test(csp), 'script-src debe permitir el SDK de Firebase (gstatic)');
        testRunner.assert(/script-src[^;]*cdn\.jsdelivr\.net/i.test(csp), 'script-src debe permitir jsdelivr (iconos)');
    },

    "permite conectar a Firebase, clima y el webhook de OCR"() {
        const csp = readCsp();
        testRunner.assert(/connect-src[^;]*googleapis\.com/i.test(csp), 'connect-src debe permitir Firestore/Storage/Auth (googleapis)');
        testRunner.assert(/connect-src[^;]*api\.weatherapi\.com/i.test(csp), 'connect-src debe permitir weatherapi');
        testRunner.assert(/connect-src[^;]*n8n\.erlin\.do/i.test(csp), 'connect-src debe permitir el webhook de caja chica (n8n)');
    },

    "permite el espejo de caja chica en Supabase y el beacon de analytics"() {
        const csp = readCsp();
        testRunner.assert(/connect-src[^;]*supabase\.co/i.test(csp),
            'connect-src debe permitir el mirror de caja chica (*.supabase.co)');
        testRunner.assert(/script-src[^;]*static\.cloudflareinsights\.com/i.test(csp),
            'script-src debe permitir el beacon auto-inyectado de Cloudflare Web Analytics');
        testRunner.assert(/connect-src[^;]*static\.cloudflareinsights\.com/i.test(csp),
            'connect-src debe permitir el reporte del beacon de Cloudflare');
    },

    "permite el popup de inicio de sesión de Google"() {
        const csp = readCsp();
        testRunner.assert(/frame-src[^;]*accounts\.google\.com/i.test(csp), 'frame-src debe permitir accounts.google.com (signInWithPopup)');
        testRunner.assert(/frame-src[^;]*firebaseapp\.com/i.test(csp), 'frame-src debe permitir el authDomain (*.firebaseapp.com)');
    }

});
