import { Position } from '../modules/features/employees/Position.js';
import {
    POSITION_ICON_OPTIONS,
    renderPositionIconSvg,
    renderPositionUiSvg,
    resolveLeaderIcon,
    resolvePositionIcon,
    safePositionColor
} from '../modules/features/employees/PositionVisuals.js';

describe('metadatos visuales de puestos', () => {
    test('Position conserva el icono opcional al serializar', () => {
        const position = new Position({
            id: 'p1',
            name: 'Electricista',
            color: '#3b82f6',
            icon: 'zap'
        });

        expect(position.toJSON().icon).toBe('zap');
    });

    test('los puestos existentes reciben un icono derivado sin modificar sus datos', () => {
        expect(resolvePositionIcon({ name: 'Capataz' })).toBe('supervisor');
        expect(resolvePositionIcon({ name: 'Puesto sin categoría' })).toBe('hard-hat');
        expect(resolvePositionIcon({ icon: 'zap' })).toBe('electrical');
    });

    test('los líderes usan supervisión por defecto y respetan un icono válido', () => {
        expect(resolveLeaderIcon({ name: 'Roberto' })).toBe('supervisor');
        expect(resolveLeaderIcon({ icon: 'tractor' })).toBe('tractor');
        expect(resolveLeaderIcon({ icon: '<script>' })).toBe('supervisor');
    });

    test('el catálogo prioriza herramientas y renderiza SVG sin depender del set global', () => {
        expect(POSITION_ICON_OPTIONS).toHaveLength(39);
        expect(POSITION_ICON_OPTIONS[0].category).toBe('heavy');
        expect(POSITION_ICON_OPTIONS[0].value).toBe('hard-hat');

        const svg = renderPositionIconSvg('hammer', { size: 28 });
        expect(svg).toContain('<svg');
        expect(svg).toContain('width="28"');
        expect(svg).toContain('stroke="currentColor"');
        expect(renderPositionUiSvg('edit')).toContain('<svg');
    });

    test('incluye maquinaria, materiales y herramientas de construcción como SVG válidos', () => {
        const constructionIcons = [
            'hammer',
            'nails',
            'wheelbarrow',
            'tractor',
            'shovel',
            'bricks',
            'trowel',
            'cement-mixer',
            'jackhammer',
            'ladder',
            'tape-measure',
            'toolbox',
            'pliers',
            'screwdriver',
            'safety-vest'
        ];

        constructionIcons.forEach(icon => {
            expect(POSITION_ICON_OPTIONS.some(option =>
                option.value === icon && option.category === 'heavy'
            )).toBe(true);
            expect(renderPositionIconSvg(icon)).toContain('<svg');
            expect(renderPositionIconSvg(icon)).not.toContain('undefined');
        });
    });

    test('deriva maquinaria frecuente a partir del nombre del puesto', () => {
        expect(resolvePositionIcon({ name: 'Operador de tractor' })).toBe('tractor');
        expect(resolvePositionIcon({ name: 'Operador de carretilla' })).toBe('wheelbarrow');
        expect(resolvePositionIcon({ name: 'Mezclador de concreto' })).toBe('cement-mixer');
        expect(resolvePositionIcon({ name: 'Demolición' })).toBe('jackhammer');
    });

    test('rechaza colores que no sean hexadecimales seguros', () => {
        expect(safePositionColor('#22c55e')).toBe('#22c55e');
        expect(safePositionColor('red; display:none')).toBe('#06b6d4');
    });
});
