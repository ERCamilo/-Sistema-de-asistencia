/**
 * 🧪 DOMDiffSwitchSiblingDraftTests (F3 — Judgment Day, cierre de hallazgo)
 *
 * Invariante verificado empíricamente por el Judge B pero sin pinear: en la
 * pantalla de Ajustes, un switch (checkbox tipo toggle, auto-save) y un
 * input borrador (texto/número, sin guardar todavía) son HERMANOS planos
 * bajo el mismo panel (ver SettingsGeneralTab.js — .stg-switch-row y
 * form-group van uno detrás del otro, sin anidarse). Al tildar un switch,
 * SettingsUI.js llama a render(), que reconstruye el árbol vía DOMDiff.
 *
 * Por qué NO se pisa el draft del input hermano: DOMDiff.patchChildren
 * recorre los hermanos por índice y, para cada par (oldChild, newChild),
 * si oldChild.isEqualNode(newChild) directamente SALTEA el parcheo de ese
 * nodo entero (optimización "Alpha"). isEqualNode compara el ATRIBUTO
 * `value` (el que quedó en el HTML rendereado), no la propiedad viva
 * `.value` que el usuario tipeó — así que un input sin cambios en su
 * markup (aunque su valor EN VIVO haya sido editado) se considera
 * "igual" y su nodo real (con el draft adentro) sobrevive intacto.
 *
 * Este test usa el DOMDiff REAL (no un mock) para pinear el contrato: si
 * un futuro refactor de markup rompe el layout plano de hermanos (p.ej.
 * anida el input DENTRO del switch, o cambia el input a un patrón donde
 * su nodo se recrea), este test debe fallar ruidosamente.
 */

import { DOMDiff } from '../modules/utils/DOMDiff.js';

function settingsHTML(switchChecked) {
    // companyName conserva siempre su value="Empresa Original": el draft
    // vive solo en el DOM (propiedad .value en vivo), nunca en state, así
    // que un re-render nunca lo reconstruye con el valor tipeado.
    return `
        <label class="stg-switch-row ${switchChecked ? 'is-active' : ''}" role="switch" aria-checked="${switchChecked}">
            <input type="checkbox" id="weatherEnabled" ${switchChecked ? 'checked' : ''}>
            <span class="stg-switch-copy"><strong>Mostrar Barra de Clima</strong></span>
        </label>
        <div class="form-group">
            <input type="text" id="companyName" value="Empresa Original" class="form-input">
        </div>
    `;
}

testRunner.addSuite("DOMDiff — F3: tildar un switch NO pisa el draft de un input hermano", {

    "el input hermano conserva su .value en vivo tras patchear SOLO el switch (DOMDiff real)"() {
        const container = document.createElement('div');
        container.className = 'stg-panel';
        document.body.appendChild(container);

        // Construcción inicial también vía DOMDiff.apply (mismo camino que
        // RenderManager usa de verdad) para que la estructura de nodos
        // (incl. whitespace text nodes) sea IDÉNTICA a la del segundo patch
        // — solo así el índice de patchChildren queda alineado y la prueba
        // ejercita el sibling-skip real, no un artefacto de whitespace.
        DOMDiff.apply(container, settingsHTML(false));

        // Simula un draft: el usuario tipeó algo que todavía no se guardó —
        // el ATRIBUTO value del markup queda igual (nadie lo re-renderizó),
        // pero la PROPIEDAD .value en vivo diverge.
        const draftInputBefore = container.querySelector('#companyName');
        draftInputBefore.value = 'Empresa Editada Sin Guardar';
        testRunner.assertEquals(draftInputBefore.value, 'Empresa Editada Sin Guardar',
            'precondición: el draft debe estar tipeado antes de patchear');

        // Solo cambia el estado del switch (checked: false → true) — el
        // input companyName NO cambia en el nuevo HTML.
        DOMDiff.apply(container, settingsHTML(true));

        const checkbox = container.querySelector('#weatherEnabled');
        testRunner.assert(checkbox.checked === true, 'el switch sí debe reflejar el nuevo estado');

        const draftInputAfter = container.querySelector('#companyName');
        testRunner.assert(draftInputAfter === draftInputBefore,
            'el nodo del input hermano NO debe recrearse (misma referencia — isEqualNode lo saltea)');
        testRunner.assertEquals(draftInputAfter.value, 'Empresa Editada Sin Guardar',
            'REGRESIÓN: tildar un switch no debe pisar el draft tipeado de un input hermano — ' +
            'si esto falla, un refactor de markup rompió el sibling-skip de DOMDiff.patchChildren ' +
            '(isEqualNode) del que depende SettingsUI para no perder drafts al auto-guardar switches');

        document.body.removeChild(container);
    }
});

console.log('🧪 DOMDiffSwitchSiblingDraftTests cargados.');
