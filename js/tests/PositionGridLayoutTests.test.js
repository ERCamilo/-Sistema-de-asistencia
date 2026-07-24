import { layoutPositionCardGrid } from '../modules/features/employees/PositionsList.js';

describe('grilla masonry de puestos', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('cada tarjeta recibe un alto de fila independiente', () => {
        document.body.innerHTML = `
            <div class="position-card-grid" style="grid-auto-rows: 8px; row-gap: 12px;">
                <article class="position-card" id="short"></article>
                <article class="position-card" id="expanded"></article>
            </div>
        `;
        const short = document.querySelector('#short');
        const expanded = document.querySelector('#expanded');
        short.getBoundingClientRect = () => ({ height: 148 });
        expanded.getBoundingClientRect = () => ({ height: 348 });

        layoutPositionCardGrid();

        expect(short.style.gridRowEnd).toBe('span 8');
        expect(expanded.style.gridRowEnd).toBe('span 18');
    });
});
