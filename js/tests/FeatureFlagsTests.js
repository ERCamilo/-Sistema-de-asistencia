/**
 * 🧪 FeatureFlagsTests (F0.6)
 *
 * El flag `projectsEnabled` aún no tiene consumidores (llegan en Fase 1).
 * Este contrato garantiza que el flag puede encenderse/apagarse sin afectar
 * nada: default OFF ante ausencia o valor inválido, y round-trip estable
 * a través del setter. Es la base segura sobre la que se conectará Proyectos.
 */

import { isProjectsEnabled, setProjectsEnabled } from '../modules/config/FeatureFlags.js';

const KEY = 'asistencia_feature_projects';

describe('FeatureFlags', () => {
    beforeEach(() => {
        localStorage.removeItem(KEY);
    });

    test('defaults to false when the key is absent', () => {
        expect(isProjectsEnabled()).toBe(false);
    });

    test('persists true/false strings and round-trips through the getter', () => {
        setProjectsEnabled(true);
        expect(localStorage.getItem(KEY)).toBe('true');
        expect(isProjectsEnabled()).toBe(true);

        setProjectsEnabled(false);
        expect(localStorage.getItem(KEY)).toBe('false');
        expect(isProjectsEnabled()).toBe(false);
    });

    test.each(['1', 'TRUE', 'True', 'yes', '0', '', 'false ', 'null'])(
        'treats invalid stored value %p as false',
        (stored) => {
            localStorage.setItem(KEY, stored);
            expect(isProjectsEnabled()).toBe(false);
        }
    );

    test('toggling twice restores the original state', () => {
        setProjectsEnabled(true);
        setProjectsEnabled(false);
        setProjectsEnabled(true);
        expect(isProjectsEnabled()).toBe(true);

        setProjectsEnabled(false);
        setProjectsEnabled(true);
        setProjectsEnabled(false);
        expect(isProjectsEnabled()).toBe(false);
    });
});
