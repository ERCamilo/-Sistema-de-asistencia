/**
 * Construction sites often have "lie-fi": a connection that is technically up
 * but answers very slowly. Network-first without a deadline made every one of
 * the ~370 boot modules wait on the network, pushing a repeat visit past the
 * boot loader's 15 s failure screen even though the whole app was cached.
 */
import { loadServiceWorker } from './helpers/serviceWorkerHarness.js';

// The harness divides the SW's own timers by 50: a ~3.5 s deadline ≈ 70 ms.
const SLOW = 1500; // real ms — far beyond the scaled deadline
const DEADLINE_BOUND = 400;

describe('Service Worker — red lenta (lie-fi)', () => {
    test('con red rápida responde la red y actualiza el caché (mismo build)', async () => {
        const sw = loadServiceWorker();
        sw.seedCache('./js/app.js', 'old');
        const res = await sw.request('./js/app.js');
        expect(res.text).toBe('net:/js/app.js');
        await sw.settle();
        expect(await sw.store.get('https://app.test/js/app.js').clone().text()).toBe('net:/js/app.js');
    });

    test('si la red tarda más del límite y hay copia, sirve el caché sin esperar', async () => {
        const sw = loadServiceWorker({ network: () => ({ delay: SLOW }) });
        sw.seedCache('./js/app.js', 'cached');
        const res = await sw.request('./js/app.js');
        expect(res.text).toBe('cached');
        expect(res.ms).toBeLessThan(DEADLINE_BOUND);
    });

    test('tras un timeout, el resto del arranque sale del caché al instante (modo degradado)', async () => {
        const sw = loadServiceWorker({ network: () => ({ delay: SLOW }) });
        sw.seedCache('./js/app.js', 'cached-app');
        sw.seedCache('./css/styles.css', 'cached-css');
        await sw.request('./js/app.js');

        const res = await sw.request('./css/styles.css');
        expect(res.text).toBe('cached-css');
        expect(res.ms).toBeLessThan(50);
    });

    test('una red lenta pero por debajo del límite también activa el modo degradado', async () => {
        // ~1.5 s por petición: ninguna llega al límite, pero esperar a la red
        // en cada nivel del árbol de imports suma ~11 s de arranque.
        const sw = loadServiceWorker({ network: () => ({ delay: 40, body: 'slow-net' }) });
        sw.seedCache('./index.html', 'cached-index');
        sw.seedCache('./js/app.js', 'cached-app');

        const first = await sw.request('./index.html', 'navigate');
        expect(first.text).toBe('slow-net'); // a tiempo: gana la red

        const next = await sw.request('./js/app.js');
        expect(next.text).toBe('cached-app');
        expect(next.ms).toBeLessThan(20);
    });

    test('la respuesta lenta de la red igual refresca el caché en segundo plano', async () => {
        const sw = loadServiceWorker({ network: () => ({ delay: 200, body: 'fresh' }) });
        sw.seedCache('./js/app.js', 'cached');
        expect((await sw.request('./js/app.js')).text).toBe('cached');
        await sw.settle();
        expect(await sw.store.get('https://app.test/js/app.js').clone().text()).toBe('fresh');
    });

    test('sin copia en caché espera a la red aunque sea lenta (nunca un 503 prematuro)', async () => {
        const sw = loadServiceWorker({ network: () => ({ delay: 300, body: 'slow-but-ok' }) });
        const res = await sw.request('./js/never-cached.js');
        expect(res.status).toBe(200);
        expect(res.text).toBe('slow-but-ok');
    });

    test('sin red y con copia, cae al caché', async () => {
        const sw = loadServiceWorker({ network: () => ({ fail: true }) });
        sw.seedCache('./js/app.js', 'cached');
        expect((await sw.request('./js/app.js')).text).toBe('cached');
    });

    test('la navegación lenta usa el index.html cacheado', async () => {
        const sw = loadServiceWorker({ network: () => ({ delay: SLOW }) });
        sw.seedCache('./index.html', '<html>cached</html>');
        const res = await sw.request('./index.html', 'navigate');
        expect(res.text).toBe('<html>cached</html>');
        expect(res.ms).toBeLessThan(DEADLINE_BOUND);
    });

    test('al vencer la ventana degradada vuelve a preferir la red', async () => {
        let delay = SLOW;
        const sw = loadServiceWorker({ network: () => ({ delay }) });
        sw.seedCache('./js/app.js', 'cached');
        await sw.request('./js/app.js'); // timeout → degradado

        delay = 0;
        sw.clock.now += 5 * 60 * 1000;
        const res = await sw.request('./js/app.js');
        expect(res.text).toBe('net:/js/app.js');
    });
});
