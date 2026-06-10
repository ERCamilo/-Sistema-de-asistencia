/**
 * 🧪 LogoutCleanupTests (Auditoría 2026-06-09, hallazgo M6)
 *
 * El backup automático en sessionStorage ('attendance-backup') contiene el
 * estado completo en claro (salarios, préstamos, teléfonos, RNC). Al cerrar
 * sesión NO se borraba: en un equipo compartido, el siguiente usuario podía
 * leerlo desde la consola. logout() ahora limpia ese respaldo de sesión.
 *
 * (Contrato sobre el fuente: FirebaseService está mockeado por moduleNameMapper,
 * así que verificamos el cuerpo real de logout() leyendo el archivo.)
 *
 * Contrato:
 *   - logout() elimina sessionStorage['attendance-backup'].
 *   - logout() sigue llamando a signOut() (no rompe el cierre de sesión).
 */

import fs from 'fs';
import path from 'path';

const FB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);

testRunner.addSuite("Logout — limpia el respaldo sensible de sesión (M6)", {

    "logout() borra el auto-backup de sessionStorage"() {
        const block = FB_SRC.match(/async logout\s*\([\s\S]{0,900}?\n    \}/);
        testRunner.assert(!!block, 'logout() debe existir');
        testRunner.assert(
            /sessionStorage[\s\S]*attendance-backup|attendance-backup[\s\S]*sessionStorage/.test(block[0]),
            'logout() debe eliminar el respaldo sensible de sessionStorage (attendance-backup)'
        );
        testRunner.assert(/removeItem|clear\s*\(/.test(block[0]),
            'debe usar removeItem/clear para borrar el respaldo');
    },

    "logout() sigue invocando signOut()"() {
        const block = FB_SRC.match(/async logout\s*\([\s\S]{0,900}?\n    \}/);
        testRunner.assert(!!block, 'logout() debe existir');
        testRunner.assert(/signOut\s*\(/.test(block[0]),
            'logout() debe seguir cerrando la sesión con signOut()');
    }

});
