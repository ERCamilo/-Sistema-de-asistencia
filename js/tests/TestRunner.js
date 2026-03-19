/**
 * 🧪 TestRunner - Motor de pruebas ligero para el Sistema de Asistencia
 */
class TestRunner {
    constructor() {
        this.suites = [];
        this.results = [];
    }

    addSuite(name, tests) {
        this.suites.push({ name, tests });
    }

    async runAll() {
        console.log('%c 🧪 Iniciando Suite de Pruebas Unitarias ', 'background: #222; color: #bada55; font-size: 1.2em; font-weight: bold;');
        this.results = [];
        let total = 0;
        let passed = 0;

        for (const suite of this.suites) {
            console.group(`📦 Suite: ${suite.name}`);
            for (const [testName, testFn] of Object.entries(suite.tests)) {
                total++;
                try {
                    await testFn();
                    console.log(`✅ ${testName}`);
                    passed++;
                    this.results.push({ suite: suite.name, test: testName, status: 'PASS' });
                } catch (error) {
                    console.error(`❌ ${testName}\n   Error: ${error.message}`);
                    this.results.push({ suite: suite.name, test: testName, status: 'FAIL', error: error.message });
                }
            }
            console.groupEnd();
        }

        const color = passed === total ? '#4CAF50' : '#f44336';
        console.log(`%c 📊 Resultado Final: ${passed}/${total} pruebas pasadas `, `background: ${color}; color: white; font-weight: bold; padding: 5px; border-radius: 3px;`);
        
        return { total, passed, failed: total - passed, results: this.results };
    }

    // Heplers de aserción
    assert(condition, message) {
        if (!condition) throw new Error(message || "Assertion failed");
    }

    assertEquals(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(`${message || "Value mismatch"}: Esperado "${expected}", Recibido "${actual}"`);
        }
    }
}

// Instancia global para depuración
window.testRunner = new TestRunner();
