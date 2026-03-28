/**
 * 🔄 LAZYLOADER (Fase 3 - Modularización)
 * Gestiona el lazy loading de recursos (imágenes, scripts, estilos y componentes).
 */

import { debug } from './Debug.js';

class LazyLoader {
    constructor() {
        this._loaded = new Set();
        this._loading = new Map();
        this._observers = new Map();
    }

    /**
     * Lazy load de imágenes usando IntersectionObserver
     */
    lazyLoadImages(selector = 'img[data-src]') {
        const images = document.querySelectorAll(selector);

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        observer.unobserve(img);
                    }
                });
            });

            images.forEach(img => observer.observe(img));
            this._observers.set(selector, observer);
        } else {
            images.forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
        }
    }

    /**
     * Carga dinámica de componentes (Promisified)
     */
    async loadComponent(componentName, loader) {
        if (this._loaded.has(componentName)) return true;
        if (this._loading.has(componentName)) return this._loading.get(componentName);

        const loadPromise = (async () => {
            try {
                await loader();
                this._loaded.add(componentName);
                return true;
            } catch (error) {
                console.error(`❌ Error cargando '${componentName}':`, error);
                return false;
            } finally {
                this._loading.delete(componentName);
            }
        })();

        this._loading.set(componentName, loadPromise);
        return loadPromise;
    }

    /**
     * Precargar scripts o estilos
     */
    preload(url, type = 'script') {
        return new Promise((resolve, reject) => {
            if (this._loaded.has(url)) return resolve();

            const element = type === 'script'
                ? document.createElement('script')
                : document.createElement('link');

            if (type === 'script') {
                element.src = url;
            } else {
                element.rel = 'stylesheet';
                element.href = url;
            }

            element.onload = () => {
                this._loaded.add(url);
                resolve();
            };
            element.onerror = reject;
            document.head.appendChild(element);
        });
    }

    cleanup() {
        this._observers.forEach(observer => observer.disconnect());
        this._observers.clear();
    }
}

export const lazyLoader = new LazyLoader();
export default lazyLoader;
