/**
 * Runs the real sw.js inside a vm sandbox with an in-memory Cache Storage, a
 * scriptable network and a controllable clock, so tests can assert the
 * Service Worker's *behaviour* (what it answers, and when) instead of grepping
 * its source text.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

export const ORIGIN = 'https://app.test';
const BASE = `${ORIGIN}/`;
const swSource = fs.readFileSync(path.resolve(__dirname, '../../../sw.js'), 'utf8');

/** Minimal stand-in for the Fetch API Response (jsdom does not provide one). */
class FakeResponse {
    constructor(body = '', { status = 200 } = {}) {
        this.body = String(body);
        this.status = status;
        this.ok = status >= 200 && status < 300;
    }
    clone() { return new FakeResponse(this.body, { status: this.status }); }
    async text() { return this.body; }
}

const keyOf = (input) => new URL(typeof input === 'string' ? input : input.url, BASE).href;

export function createRequest(relativeUrl, mode = 'cors') {
    return { url: keyOf(relativeUrl), method: 'GET', mode };
}

/**
 * @param {object} opts
 * @param {(url: string) => {body?: string, delay?: number, fail?: boolean, status?: number}} [opts.network]
 *   Per-URL network behaviour. Default: instant 200 with body `net:<path>`.
 * @param {string[]} [opts.manifest] value exposed as self.SW_PRECACHE_MANIFEST by importScripts.
 * @param {number} [opts.timeScale] divides the SW's own setTimeout delays (keeps tests fast).
 */
export function loadServiceWorker({ network, manifest = [], timeScale = 50 } = {}) {
    const listeners = {};
    const store = new Map();
    const fetchLog = [];
    const imported = [];
    const clock = { now: Date.now() };

    const behaviourFor = (url) => (network ? network(url) : {}) || {};

    const fakeFetch = (input) => {
        const url = keyOf(input);
        fetchLog.push(url);
        const { body = `net:${new URL(url).pathname}`, delay = 0, fail = false, status = 200 } = behaviourFor(url);
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (fail) reject(new TypeError('Failed to fetch'));
                else resolve(new FakeResponse(body, { status }));
            }, delay);
        });
    };

    const cache = {
        match: async (req) => store.get(keyOf(req))?.clone(),
        put: async (req, res) => { store.set(keyOf(req), res); },
        add: async (req) => {
            const res = await fakeFetch(req);
            if (!res.ok) throw new TypeError(`bad status ${res.status}`);
            store.set(keyOf(req), res);
        },
        keys: async () => [...store.keys()]
    };

    class SandboxDate extends Date {
        static now() { return clock.now; }
    }

    const self = {
        location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        skipWaiting: async () => {},
        clients: { claim: async () => {} }
    };
    const context = vm.createContext({
        self,
        caches: {
            open: async () => cache,
            match: async (req) => cache.match(req),
            keys: async () => [],
            delete: async () => true
        },
        fetch: fakeFetch,
        Request: class SandboxRequest {
            constructor(input, init = {}) {
                this.url = keyOf(input);
                this.method = 'GET';
                this.mode = 'cors';
                this.cache = init.cache;
            }
        },
        Response: FakeResponse,
        URL,
        Date: SandboxDate,
        Promise,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: (fn, ms = 0) => setTimeout(fn, ms / timeScale),
        clearTimeout,
        importScripts: (...urls) => {
            imported.push(...urls);
            self.SW_PRECACHE_MANIFEST = manifest;
        }
    });
    vm.runInContext(swSource, context);

    const pendingWork = [];
    const makeEvent = (extra) => ({
        waitUntil: (p) => { pendingWork.push(Promise.resolve(p).catch(() => {})); },
        ...extra
    });

    return {
        store,
        fetchLog,
        imported,
        clock,
        seedCache(relativeUrl, body) {
            store.set(keyOf(relativeUrl), new FakeResponse(body));
        },
        async install() {
            const event = makeEvent({});
            listeners.install(event);
            await Promise.all(pendingWork);
        },
        /** Dispatches a fetch event; resolves with { text, ms } of the answer. */
        async request(relativeUrl, mode = 'cors') {
            let answer = null;
            const started = Date.now();
            const event = makeEvent({
                request: createRequest(relativeUrl, mode),
                respondWith: (p) => { answer = p; }
            });
            listeners.fetch(event);
            if (!answer) return null;
            const res = await answer;
            return { text: await res.text(), status: res.status, ms: Date.now() - started };
        },
        /** Waits for background revalidations registered through waitUntil. */
        settle: () => Promise.all(pendingWork)
    };
}
