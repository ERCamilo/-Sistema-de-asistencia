/**
 * 🧪 HelpTooltipTests — Pruebas para el sistema de tooltips de ayuda
 *
 * Verifica:
 *   - HelpController gestiona modos (off / first-time / always)
 *   - HelpController persiste el estado de "visto" por campo
 *   - HelpTooltip renderiza el botón (?) correctamente
 *   - El tooltip muestra título y texto del diccionario
 *   - "first-time" muestra solo en el primer focus
 *   - "always" muestra en cada focus
 *   - "off" nunca auto-muestra
 *   - Marcar como visto persiste entre sesiones (vía settings)
 */

import { HelpController } from '../modules/components/HelpController.js';
import { HelpTooltip } from '../modules/components/HelpTooltip.js';
import { HELP_TEXTS } from '../modules/components/helpTexts.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function createIsolatedController() {
    // Estado de prueba aislado (no toca settings reales ni localStorage)
    const fakeSettings = { helpMode: 'first-time' };
    const fakeSeen = {};
    return new HelpController({
        getSettings: () => fakeSettings,
        getSeenMap: () => fakeSeen,
        persist: () => { /* no-op para tests */ }
    });
}

function cleanupTooltips() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    document.body.style.overflow = '';
}

async function waitForOpen() {
    return new Promise(r => setTimeout(r, 50));
}

async function waitForClose() {
    return new Promise(r => setTimeout(r, 350));
}

// ─────────────────────────────────────────────────────────────
// Suite: HelpController
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("HelpController — Modos", {

    "modo 'off': shouldAutoShow nunca devuelve true"() {
        const ctrl = createIsolatedController();
        ctrl.setMode('off');
        testRunner.assert(!ctrl.shouldAutoShow('any.key'), "modo off no debe auto-mostrar");
    },

    "modo 'always': shouldAutoShow siempre devuelve true"() {
        const ctrl = createIsolatedController();
        ctrl.setMode('always');
        testRunner.assert(ctrl.shouldAutoShow('any.key'), "modo always debe auto-mostrar");
        ctrl.markSeen('any.key');
        testRunner.assert(
            ctrl.shouldAutoShow('any.key'),
            "modo always ignora si ya se vio"
        );
    },

    "modo 'first-time': muestra solo la primera vez"() {
        const ctrl = createIsolatedController();
        ctrl.setMode('first-time');

        testRunner.assert(
            ctrl.shouldAutoShow('position.hourlyRate'),
            "Primera vez: debe auto-mostrar"
        );

        ctrl.markSeen('position.hourlyRate');

        testRunner.assert(
            !ctrl.shouldAutoShow('position.hourlyRate'),
            "Segunda vez: NO debe auto-mostrar"
        );
    },

    "modo 'first-time': independiente por clave"() {
        const ctrl = createIsolatedController();
        ctrl.setMode('first-time');

        ctrl.markSeen('position.hourlyRate');

        testRunner.assert(
            !ctrl.shouldAutoShow('position.hourlyRate'),
            "Clave ya vista no debe mostrar"
        );
        testRunner.assert(
            ctrl.shouldAutoShow('position.workingDays'),
            "Otra clave (no vista) sí debe mostrar"
        );
    },

    "hasBeenSeen refleja correctamente el estado"() {
        const ctrl = createIsolatedController();
        testRunner.assert(!ctrl.hasBeenSeen('foo'), "Inicialmente no vista");
        ctrl.markSeen('foo');
        testRunner.assert(ctrl.hasBeenSeen('foo'), "Tras markSeen debe ser true");
    },

    "resetAllSeen vacía el registro"() {
        const ctrl = createIsolatedController();
        ctrl.markSeen('a');
        ctrl.markSeen('b');
        ctrl.resetAllSeen();
        testRunner.assert(!ctrl.hasBeenSeen('a'), "tras reset, 'a' no debe estar vista");
        testRunner.assert(!ctrl.hasBeenSeen('b'), "tras reset, 'b' no debe estar vista");
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: helpTexts diccionario
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("helpTexts — Diccionario", {

    "exporta objeto HELP_TEXTS"() {
        testRunner.assert(typeof HELP_TEXTS === 'object', "HELP_TEXTS debe ser un objeto");
        testRunner.assert(Object.keys(HELP_TEXTS).length > 0, "Debe haber al menos un texto");
    },

    "cada entrada tiene title y body"() {
        for (const [key, value] of Object.entries(HELP_TEXTS)) {
            testRunner.assert(
                typeof value.title === 'string' && value.title.length > 0,
                `${key}: title debe ser string no vacío`
            );
            testRunner.assert(
                typeof value.body === 'string' && value.body.length > 0,
                `${key}: body debe ser string no vacío`
            );
        }
    },

    "incluye claves esperadas para PositionModal"() {
        const expected = ['position.hourlyRate', 'position.workingDays'];
        for (const key of expected) {
            testRunner.assert(
                HELP_TEXTS[key] !== undefined,
                `Falta la clave: ${key}`
            );
        }
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: HelpTooltip render
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("HelpTooltip — Render", {

    "render() genera un button con data-help"() {
        const html = HelpTooltip.render('position.hourlyRate');
        testRunner.assert(html.includes('data-help'), "Debe incluir data-help");
        testRunner.assert(
            html.includes('position.hourlyRate'),
            "data-help debe contener la clave"
        );
    },

    "render() incluye aria-label descriptivo"() {
        const html = HelpTooltip.render('position.hourlyRate');
        testRunner.assert(
            html.includes('aria-label'),
            "Debe tener aria-label para accesibilidad"
        );
    },

    "render() devuelve string vacío si la clave no existe"() {
        const html = HelpTooltip.render('clave.inexistente');
        testRunner.assertEquals(html, '', "Clave inexistente debe retornar string vacío");
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: HelpTooltip integración (apertura de modal)
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("HelpTooltip — Integración", {

    async "show() abre un Modal con el contenido correcto"() {
        cleanupTooltips();

        HelpTooltip.show('position.hourlyRate');
        await waitForOpen();

        const overlay = document.querySelector('.modal-overlay');
        testRunner.assert(overlay !== null, "Debe haber un modal en el DOM");

        const text = overlay.textContent;
        testRunner.assert(
            text.includes(HELP_TEXTS['position.hourlyRate'].title),
            "El modal debe contener el title del helpText"
        );

        // Cleanup
        const okBtn = Array.from(overlay.querySelectorAll('button'))
            .find(b => b.textContent.trim() === 'Entendido' || b.textContent.trim() === 'OK');
        if (okBtn) okBtn.click();
        await waitForClose();
    },

    async "show() de clave inexistente no abre nada"() {
        cleanupTooltips();
        const before = document.querySelectorAll('.modal-overlay').length;

        HelpTooltip.show('clave.inexistente');
        await waitForOpen();

        const after = document.querySelectorAll('.modal-overlay').length;
        testRunner.assertEquals(after, before, "No debe haber abierto modal");
    }
});

console.log('🧪 HelpTooltip tests cargados.');
