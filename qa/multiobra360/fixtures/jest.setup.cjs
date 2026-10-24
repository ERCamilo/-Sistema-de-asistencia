/**
 * jest.setup.js — Configuración global del entorno de tests.
 *
 * Se ejecuta después del framework (setupFilesAfterFramework) en cada test,
 * dentro del entorno jsdom, por lo que `window`, `document` y los globales
 * de Jest (describe, it, expect) están disponibles.
 */

// ─── Polyfills que jsdom no provee por defecto ───────────────────────────────

if (!window.requestIdleCallback) {
    window.requestIdleCallback = (cb) => setTimeout(() => cb({ timeRemaining: () => 50 }), 0);
    window.cancelIdleCallback = (id) => clearTimeout(id);
}

// app.js llama a window.render() desde AppState; lo dejamos como no-op
if (!window.render) {
    window.render = () => {};
}

// ─── Adaptador TestRunner → Jest ─────────────────────────────────────────────
//
// Los archivos de test originales llaman a `testRunner.addSuite(name, tests)`.
// Este adaptador traduce esas llamadas a describe/it de Jest sin modificar
// los archivos de test.

class JestTestRunner {
    constructor() {
        this.suites = [];
        this.results = [];
    }

    addSuite(name, tests) {
        describe(name, () => {
            for (const [testName, testFn] of Object.entries(tests)) {
                it(testName, testFn);
            }
        });
    }

    // API idéntica al TestRunner original para que los tests no cambien
    assert(condition, message) {
        if (!condition) throw new Error(message || 'Assertion failed');
    }

    assertEquals(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(
                `${message || 'Value mismatch'}: Esperado "${expected}", Recibido "${actual}"`
            );
        }
    }

    // No-op en entorno Jest (Jest ya reporta los resultados)
    async runAll() {}
}

const runner = new JestTestRunner();
global.testRunner = runner;
window.testRunner = runner;
