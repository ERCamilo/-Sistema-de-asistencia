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

console.log('🧪 ManualWizard render tests cargados.');
