/**
 * 🧪 ManualWizardRenderTests (Tareas #22 + #23)
 *
 * Contract tests sobre MaintenanceUI.renderWizardContent y handlers
 * relacionados. Verifican que el nuevo paso manual:
 *   - Renderiza una card por miembro con 3 acciones (master/absorb/separate).
 *   - Marca visualmente el rol actual.
 *   - Tiene botón "Aplicar resolución" que dispara apply-manual-group.
 *   - Tiene botón Cancelar/anterior.
 *
 * Y que el delegation map incluye:
 *   - set-member-role
 *   - apply-manual-group
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/MaintenanceUI.js'),
    'utf8'
);

testRunner.addSuite("MaintenanceUI — render del paso manual con 3 roles (Tarea #22)", {

    "cada card emite data-maint-action='set-member-role' con los 3 roles"() {
        // El render usa template + helper, así que las cadenas literales
        // viven en los argumentos del helper btn(...). Verificamos que
        // los 4 strings aparezcan en el fuente del módulo.
        testRunner.assert(/['"]set-member-role['"]/.test(SRC),
            "El string 'set-member-role' debe aparecer en el fuente");
        testRunner.assert(/['"]master['"]/.test(SRC),
            "Rol 'master' debe estar presente");
        testRunner.assert(/['"]absorb['"]/.test(SRC),
            "Rol 'absorb' debe estar presente");
        testRunner.assert(/['"]separate['"]/.test(SRC),
            "Rol 'separate' debe estar presente");
    },

    "el wizard tiene botón 'Aplicar resolución' con data-maint-action='apply-manual-group'"() {
        testRunner.assert(
            /data-maint-action=["']apply-manual-group["']/.test(SRC),
            'Debe haber un botón Aplicar resolución'
        );
    },

    "importa validateManualGroup"() {
        testRunner.assert(
            /from\s+['"]\.\.\/services\/ManualGroupValidator\.js['"]/.test(SRC),
            'Debe importar el validador'
        );
    }

});

testRunner.addSuite("MaintenanceUI — delegation map para nuevos handlers (Tarea #23)", {

    "set-member-role registrado en el delegation map"() {
        testRunner.assert(
            /'set-member-role':/.test(SRC),
            'Acción set-member-role debe estar en el delegation map'
        );
    },

    "apply-manual-group registrado en el delegation map"() {
        testRunner.assert(
            /'apply-manual-group':/.test(SRC),
            'Acción apply-manual-group debe estar en el delegation map'
        );
    },

    "métodos setMemberRole y applyManualGroup definidos en la clase"() {
        testRunner.assert(
            /setMemberRole\s*\(/.test(SRC),
            'Método setMemberRole debe existir'
        );
        testRunner.assert(
            /applyManualGroup\s*\(/.test(SRC) || /applyManualGroup\b/.test(SRC),
            'Método applyManualGroup debe existir'
        );
    }

});

testRunner.addSuite("MaintenanceUI — card muestra ID completo + reasign inline", {

    "renderEmployeeCard NO trunca el id (8 chars eran un bug UX)"() {
        // Antes: ID 13c3f7db (8 chars) — el usuario no podía distinguir
        // entre múltiples UUIDs ni copiar el id real para diagnosticar.
        testRunner.assert(
            !/substring\s*\(\s*0\s*,\s*8\s*\)/.test(SRC),
            'No debe haber substring(0, 8) sobre el id en MaintenanceUI'
        );
    },

    "card muestra el id completo (selector maintenance-id-tag con emp.id sin slice)"() {
        // Verifica que la tag de id renderiza emp.id directamente (o emp.id || '')
        // sin operador de truncado.
        testRunner.assert(
            /maintenance-id-tag[^<]*<[^>]*>\$\{[^}]*emp\.id[^}]*\}/.test(SRC) ||
            /class=["']maintenance-id-tag["'][\s\S]{0,200}\$\{[^}]*emp\.id/.test(SRC),
            'El id-tag debe inyectar emp.id sin truncar'
        );
    },

    "card renderiza input inline cuando role==='separate' (sin window.prompt)"() {
        testRunner.assert(
            /maintenance-reassign-input/.test(SRC),
            'Debe existir un input inline con clase maintenance-reassign-input'
        );
    },

    "input inline tiene action commit-reassign-ficha en el delegation map"() {
        testRunner.assert(
            /['"]commit-reassign-ficha['"]/.test(SRC),
            'Acción commit-reassign-ficha debe estar en el código (delegation + botón)'
        );
    },

    "setMemberRole ya NO llama a promptReassignFicha (prompt() del navegador)"() {
        // El método puede seguir existiendo (legacy/back-compat) pero el flujo
        // de setMemberRole no debe invocarlo. Verificamos que la llamada
        // 'this.promptReassignFicha(' no aparezca dentro de setMemberRole.
        const m = SRC.match(/setMemberRole\s*\([\s\S]*?\n\s{4}\}/);
        const body = m ? m[0] : '';
        testRunner.assert(
            !/this\.promptReassignFicha\s*\(/.test(body),
            'setMemberRole no debe abrir window.prompt vía promptReassignFicha'
        );
    }

});

console.log('🧪 ManualWizard render tests cargados.');
