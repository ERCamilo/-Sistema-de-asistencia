const PDFJS_VERSION = '5.7.284';
const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let pdfJsPromise = null;

export async function ensurePdfJsLoaded() {
    if (globalThis.pdfjsLib?.getDocument) return globalThis.pdfjsLib;
    if (!pdfJsPromise) {
        pdfJsPromise = import(PDFJS_URL).then((pdfjs) => {
            if (pdfjs?.GlobalWorkerOptions) {
                pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
            }
            globalThis.pdfjsLib = pdfjs;
            return pdfjs;
        }).catch((error) => {
            pdfJsPromise = null;
            throw error;
        });
    }
    return pdfJsPromise;
}

export const PDFJS_ASSETS = Object.freeze({
    version: PDFJS_VERSION,
    libraryUrl: PDFJS_URL,
    workerUrl: PDFJS_WORKER_URL
});

export default ensurePdfJsLoaded;
