/**
 * 🧪 AuthHeaderTests — badge, avatar y login realineados a su propósito.
 *
 * Feedback del usuario (2026-07-11): el badge se desvió de su idea original.
 * Debía ser SOLO una notificación de estado que, al tocarla, sincroniza
 * (flechitas girando → ✓/✗). En cambio hacía DOS cosas de un toque: abría el
 * Centro de Sincronización (CS) Y, por otra delegación, reanudaba/reintentaba.
 * Además el avatar de la derecha no tenía función, y sin sesión no había forma
 * clara de loguearse.
 *
 * Modelo nuevo (decidido con el usuario, opción B):
 *  - Sin sesión: el badge DESAPARECE; en su lugar un botón "Iniciar sesión"
 *    que abre un modal explicativo (por qué conviene la nube).
 *  - Con sesión: el badge es puro estado; al tocarlo → Sincronizar ahora (una
 *    sola función, sin modal). El avatar es la puerta al CS.
 *  - Cerrar sesión vive DENTRO del CS (acción rara → no al frente).
 */

import fs from 'fs';
import path from 'path';
import { Header } from '../modules/ui/Header.js';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const APP_SRC = read('../app.js');
const HEADER_SRC = read('../modules/ui/Header.js');

function renderHeader() {
    return Header({ companyName: 'Test', activeTab: 'attendance' });
}

testRunner.addSuite('AuthHeader — badge: una sola función, oculto sin sesión', {

    'el badge del header solo se muestra con sesión iniciada'() {
        // renderSyncStatusBadgeForHeader devuelve '' si no hay currentUser.
        const idx = APP_SRC.indexOf('renderSyncStatusBadgeForHeader = ');
        const body = APP_SRC.slice(idx, idx + 900);
        testRunner.assert(/if\s*\(\s*!window\.currentUser\s*\)\s*return\s*''/.test(body) ||
            /!window\.currentUser[\s\S]{0,40}return ''/.test(body),
            'sin sesión el badge no se renderiza (lo reemplaza el botón Iniciar sesión)');
    },

    'al tocar el badge se Sincroniza ahora (una sola función, sin abrir modal)'() {
        const idx = APP_SRC.indexOf('renderSyncStatusBadgeForHeader = ');
        const body = APP_SRC.slice(idx, idx + 1500);
        testRunner.assert(/data-app-fn="syncFirebaseNow"/.test(body),
            'el badge debe disparar syncFirebaseNow (girar → ✓/✗)');
        testRunner.assert(!/data-app-fn="openSyncCenterModal"/.test(body),
            'el badge ya NO debe abrir el CS (eso lo hace el avatar)');
    },

    'app.js ya NO pasa onPausedClick/onErrorClick al badge (fin del doble comportamiento)'() {
        const idx = APP_SRC.indexOf('attachLiveBadge({');
        const body = APP_SRC.slice(idx, idx + 1400);
        testRunner.assert(!/onPausedClick\s*:/.test(body),
            'sin onPausedClick: la reanudación se maneja desde el toggle del CS');
        testRunner.assert(!/onErrorClick\s*:/.test(body),
            'sin onErrorClick: reintentar se hace desde el CS');
    }

});

testRunner.addSuite('AuthHeader — avatar abre el CS; login sin sesión', {

    'con sesión, el avatar es un botón que abre el CS'() {
        // Simulamos sesión.
        global.window = global.window || {};
        const prev = global.window.currentUser;
        global.window.currentUser = { displayName: 'Erlin Camilo', email: 'e@x.com' };
        try {
            const html = renderHeader();
            testRunner.assert(/data-app-fn="openSyncCenterModal"/.test(html),
                'el avatar debe abrir el Centro de Sincronización');
            testRunner.assert(/header-user-pill|header-account-btn/.test(html),
                'el avatar/pill del usuario debe seguir presente');
        } finally { global.window.currentUser = prev; }
    },

    'sin sesión, aparece el botón Iniciar sesión que abre el modal de login'() {
        global.window = global.window || {};
        const prev = global.window.currentUser;
        global.window.currentUser = null;
        try {
            const html = renderHeader();
            testRunner.assert(/Iniciar sesión/i.test(html),
                'sin sesión debe verse el botón Iniciar sesión');
            testRunner.assert(/data-app-fn="openLoginModal"/.test(html),
                'ese botón debe abrir el modal de login explicativo');
        } finally { global.window.currentUser = prev; }
    }

});

testRunner.addSuite('AuthHeader — modal de login explicativo y logout en el CS', {

    'existe openLoginModal y un modal de login registrado'() {
        testRunner.assert(/window\.openLoginModal\s*=/.test(APP_SRC),
            'debe existir el handler openLoginModal');
        testRunner.assert(/'login'\s*:\s*\(\)\s*=>/.test(APP_SRC),
            'el registro de modales debe incluir la clave login');
    },

    'el modal de login explica el beneficio y ofrece iniciar sesión con Google'() {
        const idx = APP_SRC.indexOf('function buildLoginModalHTML');
        testRunner.assert(idx !== -1, 'debe existir buildLoginModalHTML');
        const body = APP_SRC.slice(idx, idx + 1800);
        testRunner.assert(/respaldo|sincroniz|nube|dispositivo/i.test(body),
            'debe explicar el beneficio (respaldo/sincronización)');
        testRunner.assert(/loginWithGoogle/.test(body),
            'debe ofrecer iniciar sesión con Google');
    },

    'el CS incluye Cerrar sesión'() {
        const idx = APP_SRC.indexOf('function SyncCenterModal');
        const body = APP_SRC.slice(idx, idx + 7000);
        testRunner.assert(/syncCenterLogout/.test(body), 'el CS debe ofrecer cerrar sesión');
        testRunner.assert(/window\.syncCenterLogout\s*=/.test(APP_SRC),
            'debe existir el handler de logout del CS');
    },

    'el botón de login usa el diseño oficial de Google (logo G de 4 colores)'() {
        const idx = APP_SRC.indexOf('function buildLoginModalHTML');
        const body = APP_SRC.slice(idx, idx + 2500);
        testRunner.assert(/google-signin-btn/.test(body),
            'debe usar la clase del botón oficial de Google');
        // El logo G oficial trae los 4 colores de marca.
        testRunner.assert(/#4285F4/i.test(body) && /#34A853/i.test(body) &&
            /#FBBC05/i.test(body) && /#EA4335/i.test(body),
            'el logo debe ser el G oficial de 4 colores (SVG inline)');
        testRunner.assert(/data-app-fn="loginWithGoogle"/.test(body),
            'el botón debe disparar el login con Google');
    },

    'al loguearse, onAuthStateChanged cierra el modal de login y vuelve a la app'() {
        const idx = APP_SRC.indexOf('onAuthStateChanged(async (user)');
        testRunner.assert(idx !== -1, 'debe existir el handler de auth');
        const body = APP_SRC.slice(idx, idx + 700);
        testRunner.assert(/modalType\s*===\s*'login'/.test(body),
            'debe detectar el modal de login abierto al loguearse');
        testRunner.assert(/showModal\s*=\s*false/.test(body),
            'debe cerrar el modal para mostrar la app de vuelta');
    }

});
