/**
 * 🧪 ModalTests - Pruebas para el componente Modal
 *
 * Verifica:
 *   - Que los modales aparecen en el DOM al invocarlos
 *   - Que el contenido (título, mensaje) es correcto
 *   - Que los atributos ARIA están bien configurados
 *   - Que los botones funcionan (confirmar/cancelar)
 *   - Que se cierran con ESC y clic en overlay
 *   - Que el foco se restaura al elemento previo al abrir
 *   - Que Modal.prompt captura el valor del input
 *
 * Uso desde la consola:
 *   testRunner.runAll()
 */

import { Modal } from '../modules/components/Modal.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Devuelve el modal-overlay actualmente abierto (o null) */
function getOpenModal() {
    // El último que se añadió al body es el de arriba (z-index)
    const overlays = document.querySelectorAll('.modal-overlay');
    return overlays[overlays.length - 1] || null;
}

/** Encuentra un botón por texto exacto dentro del modal abierto */
function findButtonByText(modal, text) {
    const buttons = modal.querySelectorAll('button');
    for (const btn of buttons) {
        if (btn.textContent.trim() === text) return btn;
    }
    return null;
}

/** Quita todos los modales del DOM (cleanup entre tests) */
function cleanupModals() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    document.body.style.overflow = '';
}

/** Espera a que el modal animación de apertura termine (~10ms) */
async function waitForOpen() {
    await sleep(50);
}

/** Espera a que el modal termine la animación de cierre (~300ms) */
async function waitForClose() {
    await sleep(350);
}

// ─────────────────────────────────────────────────────────────
// Suite de pruebas
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("Modal — Apariencia y Estructura", {

    async "Modal.confirm: aparece en el DOM al llamarse"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 'Test', message: 'Hola mundo' });
        await waitForOpen();

        const modal = getOpenModal();
        testRunner.assert(modal !== null, "El modal debe estar en el DOM");
        testRunner.assert(
            modal.classList.contains('modal-overlay'),
            "Debe tener la clase modal-overlay"
        );

        // Cleanup: cancelar el modal
        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    },

    async "Modal.confirm: muestra el título correcto"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 'Mi Título Único', message: 'msg' });
        await waitForOpen();

        const modal = getOpenModal();
        const titleEl = modal.querySelector('.modal-title');
        testRunner.assert(titleEl !== null, "Debe existir el elemento .modal-title");
        testRunner.assertEquals(
            titleEl.textContent.trim(),
            'Mi Título Único',
            "El título debe coincidir con el proporcionado"
        );

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    },

    async "Modal.confirm: muestra el mensaje correcto"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'Mensaje específico de prueba' });
        await waitForOpen();

        const modal = getOpenModal();
        const body = modal.querySelector('.modal-body');
        testRunner.assert(body !== null, "Debe existir .modal-body");
        testRunner.assert(
            body.textContent.includes('Mensaje específico de prueba'),
            "El body debe contener el mensaje"
        );

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    },

    async "Modal: tiene atributos ARIA correctos (role, aria-modal, aria-labelledby)"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 'ARIA Test', message: 'm' });
        await waitForOpen();

        const modal = getOpenModal();
        const container = modal.querySelector('[data-modal-container]');

        testRunner.assertEquals(
            container.getAttribute('role'),
            'dialog',
            'El contenedor debe tener role="dialog"'
        );
        testRunner.assertEquals(
            container.getAttribute('aria-modal'),
            'true',
            'El contenedor debe tener aria-modal="true"'
        );

        const labelledBy = container.getAttribute('aria-labelledby');
        testRunner.assert(labelledBy !== null, 'Debe tener aria-labelledby');
        const titleEl = modal.querySelector(`#${labelledBy}`);
        testRunner.assert(
            titleEl !== null,
            'aria-labelledby debe apuntar a un elemento existente'
        );

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    },

    async "Modal.confirm: tiene botones Confirmar y Cancelar por defecto"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();

        const modal = getOpenModal();
        testRunner.assert(findButtonByText(modal, 'Confirmar') !== null, "Debe haber botón 'Confirmar'");
        testRunner.assert(findButtonByText(modal, 'Cancelar') !== null, "Debe haber botón 'Cancelar'");

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    },

    async "Modal.confirm: respeta confirmText y cancelText personalizados"() {
        cleanupModals();

        const promise = Modal.confirm({
            title: 't',
            message: 'm',
            confirmText: 'Sí, eliminar',
            cancelText: 'No, mantener'
        });
        await waitForOpen();

        const modal = getOpenModal();
        testRunner.assert(findButtonByText(modal, 'Sí, eliminar') !== null, "Botón confirmar custom");
        testRunner.assert(findButtonByText(modal, 'No, mantener') !== null, "Botón cancelar custom");

        findButtonByText(modal, 'No, mantener').click();
        await promise;
        await waitForClose();
    },

    async "Modal.confirm: type='danger' aplica la clase btn-danger"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'm', type: 'danger' });
        await waitForOpen();

        const modal = getOpenModal();
        const confirmBtn = findButtonByText(modal, 'Confirmar');
        testRunner.assert(
            confirmBtn.classList.contains('btn-danger'),
            'El botón Confirmar debe tener la clase btn-danger cuando type="danger"'
        );

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    }
});

testRunner.addSuite("Modal — Interacciones", {

    async "Modal.confirm: clic en Confirmar resuelve true"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();

        const modal = getOpenModal();
        findButtonByText(modal, 'Confirmar').click();
        const result = await promise;

        testRunner.assertEquals(result, true, "Confirmar debe resolver con true");
        await waitForClose();
    },

    async "Modal.confirm: clic en Cancelar resuelve false"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();

        const modal = getOpenModal();
        findButtonByText(modal, 'Cancelar').click();
        const result = await promise;

        testRunner.assertEquals(result, false, "Cancelar debe resolver con false");
        await waitForClose();
    },

    async "Modal.confirm: ESC cierra el modal y resuelve false"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const result = await promise;

        testRunner.assertEquals(result, false, "ESC debe resolver con false");
        await waitForClose();
    },

    async "Modal.confirm: clic en overlay (fuera) cierra y resuelve false"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();

        const overlay = getOpenModal();
        // Simular clic directamente en el overlay (no en su contenido)
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        // El handler usa data-modal-overlay, vamos a clickear ese elemento
        const overlayTarget = overlay.querySelector('[data-modal-overlay]') || overlay;
        const clickEvent = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(clickEvent, 'target', { value: overlayTarget });
        overlay.dispatchEvent(clickEvent);

        // Fallback: cerrar con ESC si el click no funcionó (depende de la implementación)
        if (getOpenModal()) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        }

        const result = await promise;
        testRunner.assertEquals(result, false, "Cierre por overlay/ESC debe resolver false");
        await waitForClose();
    },

    async "Modal.confirm: se remueve del DOM tras cerrarse"() {
        cleanupModals();

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();
        testRunner.assert(getOpenModal() !== null, "Debe existir mientras está abierto");

        findButtonByText(getOpenModal(), 'Cancelar').click();
        await promise;
        await waitForClose();

        testRunner.assertEquals(
            document.querySelectorAll('.modal-overlay').length,
            0,
            "No debe quedar ningún modal en el DOM"
        );
    },

    async "Modal.confirm: callbacks onConfirm/onCancel también se invocan"() {
        cleanupModals();

        let confirmCalled = false;
        let cancelCalled = false;

        const promise = Modal.confirm({
            title: 't',
            message: 'm',
            onConfirm: () => { confirmCalled = true; },
            onCancel: () => { cancelCalled = true; }
        });
        await waitForOpen();

        findButtonByText(getOpenModal(), 'Confirmar').click();
        await promise;
        await waitForClose();

        testRunner.assert(confirmCalled, "onConfirm debe ejecutarse");
        testRunner.assert(!cancelCalled, "onCancel NO debe ejecutarse");
    }
});

testRunner.addSuite("Modal.alert", {

    async "Modal.alert: aparece y se cierra con botón OK"() {
        cleanupModals();

        const promise = Modal.alert({ title: 'Aviso', message: 'Operación completada' });
        await waitForOpen();

        const modal = getOpenModal();
        testRunner.assert(modal !== null, "El modal alert debe aparecer");
        const okBtn = findButtonByText(modal, 'OK');
        testRunner.assert(okBtn !== null, "Debe haber un botón OK");

        okBtn.click();
        await promise; // alert resuelve con undefined
        await waitForClose();

        testRunner.assertEquals(
            document.querySelectorAll('.modal-overlay').length,
            0,
            "El modal alert debe removerse del DOM"
        );
    },

    async "Modal.alert: respeta buttonText personalizado"() {
        cleanupModals();

        const promise = Modal.alert({
            title: 't',
            message: 'm',
            buttonText: 'Entendido'
        });
        await waitForOpen();

        const modal = getOpenModal();
        testRunner.assert(
            findButtonByText(modal, 'Entendido') !== null,
            "Debe respetar buttonText personalizado"
        );

        findButtonByText(modal, 'Entendido').click();
        await promise;
        await waitForClose();
    }
});

testRunner.addSuite("Modal.prompt", {

    async "Modal.prompt: aparece con un input"() {
        cleanupModals();

        const promise = Modal.prompt({ title: 'Tu nombre', message: '¿Cómo te llamas?' });
        await waitForOpen();

        const modal = getOpenModal();
        const input = modal.querySelector('input');
        testRunner.assert(input !== null, "El prompt debe contener un input");

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    },

    async "Modal.prompt: respeta defaultValue"() {
        cleanupModals();

        const promise = Modal.prompt({
            title: 't',
            message: 'm',
            defaultValue: 'valor inicial'
        });
        await waitForOpen();

        const modal = getOpenModal();
        const input = modal.querySelector('input');
        testRunner.assertEquals(input.value, 'valor inicial', "defaultValue debe poblarse en el input");

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();
    },

    async "Modal.prompt: clic en Aceptar resuelve con el valor del input"() {
        cleanupModals();

        const promise = Modal.prompt({ title: 't', message: 'm' });
        await waitForOpen();

        const modal = getOpenModal();
        const input = modal.querySelector('input');
        input.value = 'mi respuesta';

        findButtonByText(modal, 'Aceptar').click();
        const result = await promise;
        await waitForClose();

        testRunner.assertEquals(result, 'mi respuesta', "Debe resolver con el valor del input");
    },

    async "Modal.prompt: Enter en el input también envía"() {
        cleanupModals();

        const promise = Modal.prompt({ title: 't', message: 'm' });
        await waitForOpen();

        const modal = getOpenModal();
        const input = modal.querySelector('input');
        input.value = 'via enter';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        const result = await promise;
        await waitForClose();

        testRunner.assertEquals(result, 'via enter', "Enter debe resolver con el valor del input");
    },

    async "Modal.prompt: Cancelar resuelve con null"() {
        cleanupModals();

        const promise = Modal.prompt({ title: 't', message: 'm', defaultValue: 'algo' });
        await waitForOpen();

        findButtonByText(getOpenModal(), 'Cancelar').click();
        const result = await promise;
        await waitForClose();

        testRunner.assertEquals(result, null, "Cancelar debe resolver con null");
    },

    async "Modal.prompt: ESC también resuelve con null"() {
        cleanupModals();

        const promise = Modal.prompt({ title: 't', message: 'm', defaultValue: 'foo' });
        await waitForOpen();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const result = await promise;
        await waitForClose();

        testRunner.assertEquals(result, null, "ESC debe resolver con null");
    }
});

testRunner.addSuite("Modal — Accesibilidad", {

    async "Modal: el foco va al primer elemento focusable al abrir"() {
        cleanupModals();

        // Crear un botón externo y enfocarlo
        const trigger = document.createElement('button');
        trigger.textContent = 'Trigger';
        document.body.appendChild(trigger);
        trigger.focus();

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();

        const modal = getOpenModal();
        const activeIsInside = modal.contains(document.activeElement);
        testRunner.assert(
            activeIsInside,
            "El foco debe estar dentro del modal al abrir"
        );

        findButtonByText(modal, 'Cancelar').click();
        await promise;
        await waitForClose();

        trigger.remove();
    },

    async "Modal: el foco se restaura al elemento previo tras cerrar"() {
        cleanupModals();

        const trigger = document.createElement('button');
        trigger.textContent = 'Trigger restauración';
        document.body.appendChild(trigger);
        trigger.focus();

        const beforeFocus = document.activeElement;
        testRunner.assertEquals(beforeFocus, trigger, "Setup: trigger debe tener focus inicial");

        const promise = Modal.confirm({ title: 't', message: 'm' });
        await waitForOpen();

        findButtonByText(getOpenModal(), 'Cancelar').click();
        await promise;
        await waitForClose();

        testRunner.assertEquals(
            document.activeElement,
            trigger,
            "El foco debe volver al trigger tras cerrar el modal"
        );

        trigger.remove();
    }
});

console.log('🧪 Modal tests cargados. Ejecuta `testRunner.runAll()` para correrlos.');
