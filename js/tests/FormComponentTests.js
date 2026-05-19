/**
 * 🧪 FormComponentTests — Tests for the generic form component
 *
 * Covers:
 *   - Renders all field types
 *   - Required field validation triggers on blur
 *   - Submit calls onSubmit with collected data
 *   - Submit blocks if required field is empty
 *   - Double submit is prevented (anti-double-submit guard)
 *   - Cancel button invokes onCancel
 *   - Pre-filled values from props.values appear in inputs
 */

import { FormComponent } from '../modules/components/FormComponent.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mountForm(props) {
    const form = new FormComponent(props);
    const el = form.render();
    document.body.appendChild(el);
    return { form, el };
}

function cleanup() {
    document.body.innerHTML = '';
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function findError(el, fieldName) {
    return el.querySelector(`[data-field="${fieldName}"] .form-error`);
}

// ─────────────────────────────────────────────────────────────
// Suite: FormComponent — Rendering
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("FormComponent — Rendering", {

    "renders text input from field definition"() {
        cleanup();
        const { el } = mountForm({
            fields: [{ name: 'username', label: 'Username', type: 'text' }]
        });
        const input = el.querySelector('input[name="username"]');
        testRunner.assert(input !== null, "Input should be in DOM");
        testRunner.assertEquals(input.type, 'text', "Type should be text");
    },

    "pre-fills inputs from props.values"() {
        cleanup();
        const { el } = mountForm({
            fields: [{ name: 'email', label: 'Email', type: 'email' }],
            values: { email: 'test@example.com' }
        });
        const input = el.querySelector('input[name="email"]');
        testRunner.assertEquals(
            input.value,
            'test@example.com',
            "Pre-filled value should appear in the input"
        );
    },

    "shows cancel button only when onCancel is provided"() {
        cleanup();
        const { el } = mountForm({
            fields: [{ name: 'x', label: 'X', type: 'text' }],
            onCancel: () => {}
        });
        const cancelBtn = el.querySelector('[data-action="cancel"]');
        testRunner.assert(cancelBtn !== null, "Cancel button should exist when onCancel is set");
    },

    "omits cancel button when onCancel is not provided"() {
        cleanup();
        const { el } = mountForm({
            fields: [{ name: 'x', label: 'X', type: 'text' }]
        });
        const cancelBtn = el.querySelector('[data-action="cancel"]');
        testRunner.assertEquals(cancelBtn, null, "Cancel button should NOT exist without onCancel");
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: FormComponent — Validation
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("FormComponent — Validation", {

    "required field shows error on blur when empty"() {
        cleanup();
        const { el } = mountForm({
            fields: [{ name: 'name', label: 'Name', type: 'text', required: true }]
        });
        const input = el.querySelector('input[name="name"]');
        input.value = '';
        input.dispatchEvent(new Event('blur'));

        const err = findError(el, 'name');
        testRunner.assert(err !== null, "Error element should exist");
        testRunner.assertEquals(
            err.style.display,
            'block',
            "Error should be visible after blur on empty required field"
        );
    },

    "input event clears the inline error"() {
        cleanup();
        const { el } = mountForm({
            fields: [{ name: 'name', label: 'Name', type: 'text', required: true }]
        });
        const input = el.querySelector('input[name="name"]');

        // Trigger error
        input.value = '';
        input.dispatchEvent(new Event('blur'));
        const err = findError(el, 'name');
        testRunner.assertEquals(err.style.display, 'block', "Pre-condition: error shown");

        // Type something — input event should clear the error
        input.value = 'Joe';
        input.dispatchEvent(new Event('input'));
        testRunner.assertEquals(
            err.style.display,
            'none',
            "Error should be cleared after typing"
        );
    },

    "number field rejects values above max"() {
        cleanup();
        const { el } = mountForm({
            fields: [{ name: 'age', label: 'Age', type: 'number', max: 120 }]
        });
        const input = el.querySelector('input[name="age"]');
        input.value = '999';
        input.dispatchEvent(new Event('blur'));

        const err = findError(el, 'age');
        testRunner.assertEquals(err.style.display, 'block', "Should flag value above max");
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: FormComponent — Submit flow
// ─────────────────────────────────────────────────────────────

testRunner.addSuite("FormComponent — Submit", {

    async "onSubmit receives data collected from inputs"() {
        cleanup();
        let receivedData = null;
        const { el } = mountForm({
            fields: [
                { name: 'name', label: 'Name', type: 'text' },
                { name: 'note', label: 'Note', type: 'textarea' }
            ],
            onSubmit: (data) => { receivedData = data; }
        });

        el.querySelector('input[name="name"]').value = 'Ada';
        el.querySelector('textarea[name="note"]').value = 'hello';

        el.dispatchEvent(new Event('submit'));
        await sleep(20);

        testRunner.assert(receivedData !== null, "onSubmit should have been called");
        testRunner.assertEquals(receivedData.name, 'Ada', "Name should be in submitted data");
        testRunner.assertEquals(receivedData.note, 'hello', "Note should be in submitted data");
    },

    async "blocks submit when a required field is empty"() {
        cleanup();
        let called = false;
        const { el } = mountForm({
            fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
            onSubmit: () => { called = true; }
        });

        // Don't fill anything
        el.dispatchEvent(new Event('submit'));
        await sleep(20);

        testRunner.assertEquals(called, false, "onSubmit must NOT be called when validation fails");
    },

    async "double submit is prevented (only one onSubmit call)"() {
        cleanup();
        let callCount = 0;
        const { el } = mountForm({
            fields: [{ name: 'name', label: 'Name', type: 'text' }],
            onSubmit: async () => {
                callCount++;
                await sleep(50); // simulate slow save
            }
        });
        el.querySelector('input[name="name"]').value = 'X';

        // Fire two submits in quick succession
        el.dispatchEvent(new Event('submit'));
        el.dispatchEvent(new Event('submit'));
        await sleep(120); // wait for the slow save to finish

        testRunner.assertEquals(callCount, 1, "Anti-double-submit: onSubmit should run only once");
    },

    "onCancel fires when the cancel button is clicked"() {
        cleanup();
        let cancelled = false;
        const { el } = mountForm({
            fields: [{ name: 'x', label: 'X', type: 'text' }],
            onCancel: () => { cancelled = true; }
        });
        const cancelBtn = el.querySelector('[data-action="cancel"]');
        cancelBtn.click();

        testRunner.assertEquals(cancelled, true, "onCancel callback should fire on click");
    }
});

console.log('🧪 FormComponent tests cargados.');
