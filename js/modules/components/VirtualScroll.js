/**
 * 📜 VirtualScroll.js - Componente de Desplazamiento Virtual
 * Parte de la Fase 6: Infraestructura de UI (Alpha Refactorizer)
 * Permite renderizar miles de filas con un rendimiento de 60 FPS.
 */

import { ComponentBase } from './ComponentBase.js';

export class VirtualScrollComponent extends ComponentBase {
    constructor(props) {
        super(props);
        // props: { items, itemHeight, containerHeight, renderItem, buffer }
        this.scrollTop = 0;
        this.container = null;
    }

    calculateVisibleRange() {
        const { items, itemHeight, containerHeight, buffer = 5 } = this.props;

        if (!items || items.length === 0) {
            return { start: 0, end: 0, offsetY: 0 };
        }

        const visibleCount = Math.ceil(containerHeight / itemHeight);
        const startIndex = Math.floor(this.scrollTop / itemHeight);
        const endIndex = startIndex + visibleCount;

        return {
            start: Math.max(0, startIndex - buffer),
            end: Math.min(items.length, endIndex + buffer),
            offsetY: Math.max(0, startIndex - buffer) * itemHeight
        };
    }

    handleScroll(event) {
        this.scrollTop = event.target.scrollTop;
        this.updateVisibleItems();
    }

    updateVisibleItems() {
        if (!this.container) return;

        const { items, renderItem } = this.props;
        const { start, end, offsetY } = this.calculateVisibleRange();

        const visibleItems = items.slice(start, end);
        const content = this.container.querySelector('.virtual-scroll-content');

        if (content) {
            content.innerHTML = visibleItems.map(item => renderItem(item)).join('');
            content.style.transform = `translateY(${offsetY}px)`;
        }
    }

    render() {
        const { items = [], itemHeight, containerHeight } = this.props;
        const totalHeight = items.length * itemHeight;
        const { start, end, offsetY } = this.calculateVisibleRange();
        const visibleItems = items.slice(start, end);

        const id = `virtual-scroll-${Date.now()}`;

        // Guardar referencia después del render (usando setTimeout en el entorno Browser)
        // En un sistema POO real, el orquestador llamaría a una fase de post-renderizado.
        setTimeout(() => {
            this.container = document.getElementById(id);
            if (this.container) {
                this.container.addEventListener('scroll', (e) => this.handleScroll(e));
            }
        }, 0);

        return `
            <div id="${id}" class="virtual-scroll-container" 
                 style="height: ${containerHeight}px; overflow-y: auto; position: relative; width: 100%;">
                <div class="virtual-scroll-spacer" style="height: ${totalHeight}px; position: relative;">
                    <div class="virtual-scroll-content" style="position: absolute; top: 0; left: 0; width: 100%; transform: translateY(${offsetY}px);">
                        ${visibleItems.map(item => this.props.renderItem(item)).join('')}
                    </div>
                </div>
            </div>
        `;
    }
}
