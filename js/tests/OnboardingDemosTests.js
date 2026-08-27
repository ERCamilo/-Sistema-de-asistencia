/**
 * OnboardingDemosTests.js — fase 4 del onboarding v2: demos interactivas,
 * ARIA y gestión de foco. Núcleo puro (cycleDemo/markAllPresent/cycleWeek),
 * renders de la guía con contadores derivados y arnés con trampa de foco.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultState, cycleDemo, markAllPresent, cycleWeek } from '../modules/ui/onboarding/OnboardingCore.js';
import { renderOnboarding } from '../modules/ui/onboarding/OnboardingView.js';
import {
    showOnboardingPreview, closeOnboardingPreview,
    getOverlayFocusable, trapTabKey
} from '../modules/ui/onboarding/OnboardingPreview.js';

const KEY = 'onboarding-pos';
const overlay = () => document.getElementById('onboarding-preview-overlay');
const guideStep = (s, n) => renderOnboarding({ ...s, phase: 'guide', step: n });
const countMatches = (html, attr) => (html.match(new RegExp(attr, 'g')) || []).length;

function cleanup() {
    closeOnboardingPreview();
    try { localStorage.removeItem(KEY); } catch (e) { /* sin storage */ }
}

testRunner.addSuite('Onboarding v2 — demos interactivas y accesibilidad (fase 4)', {
    'cycleDemo recorre presente→ausente→sin marcar con wrap-around'() {
        const s = defaultState();
        testRunner.assertEquals(s.demoStates.join(','), 'p,p,p', 'demo arranca con tres presentes');
        cycleDemo(s, 0);
        testRunner.assertEquals(s.demoStates[0], 'a', 'presente → ausente');
        cycleDemo(s, 0);
        testRunner.assertEquals(s.demoStates[0], null, 'ausente → sin marcar');
        cycleDemo(s, 0);
        testRunner.assertEquals(s.demoStates[0], 'p', 'sin marcar → presente (cierre del ciclo)');
        cycleDemo(s, 1);
        testRunner.assertEquals(s.demoStates[1] + '|' + s.demoStates[2], 'a|p', 'solo cambia la fila tocada');
    },
    'markAllPresent pone las tres filas en presente'() {
        const s = defaultState();
        s.demoStates = ['a', null, 'p'];
        markAllPresent(s);
        testRunner.assertEquals(s.demoStates.join(','), 'p,p,p', 'todas presentes tras Marcar todos');
    },
    'cycleWeek alterna 4 estados incluyendo feriado'() {
        const s = defaultState();
        testRunner.assertEquals(s.weekData.length + ':' + s.weekData[3].pattern[2], '4:f', 'cuatro filas, fila 004 con feriado');
        cycleWeek(s, 3, 2);
        testRunner.assertEquals(s.weekData[3].pattern[2], null, 'feriado → sin marcar');
        cycleWeek(s, 3, 2);
        testRunner.assertEquals(s.weekData[3].pattern[2], 'p', 'sin marcar → presente');
        cycleWeek(s, 3, 2);
        testRunner.assertEquals(s.weekData[3].pattern[2], 'a', 'presente → ausente');
        cycleWeek(s, 3, 2);
        testRunner.assertEquals(s.weekData[3].pattern[2], 'f', 'ausente → feriado');
    },
    'horas derivadas = presentes × jornada configurada'() {
        const s = defaultState();
        s.hours = 9;
        s.demoStates = ['p', 'a', 'p'];
        const html = guideStep(s, 2);
        testRunner.assert(html.includes('18h'), `horas = 2 presentes × 9h (HTML: ${html.match(/[^>]*\d+h</)?.[0]})`);
        testRunner.assert(html.includes('Horas'), 'tarjeta de horas presente');
    },
    'paso 2 renderiza filas interactivas y paso 3 la cuadrícula semanal'() {
        const s = defaultState();
        const att = guideStep(s, 2);
        testRunner.assertEquals(countMatches(att, 'data-act="demoRow"'), 3, 'tres botones de empleado');
        testRunner.assertEquals(countMatches(att, 'data-act="markAll"'), 1, 'botón marcar todos');
        const week = guideStep(s, 3);
        testRunner.assertEquals(countMatches(week, 'data-act="weekCell"'), 24, 'cuadrícula 4×6');
        testRunner.assert(week.includes('Total de la semana'), 'total semanal visible');
    },
    'el arnés es un diálogo modal y la barra de progreso expone el paso'() {
        cleanup();
        showOnboardingPreview();
        const ov = overlay();
        testRunner.assertEquals(ov.getAttribute('role'), 'dialog', 'role dialog en el overlay');
        testRunner.assertEquals(ov.getAttribute('aria-modal'), 'true', 'aria-modal true');
        testRunner.assertEquals(ov.getAttribute('aria-label'), 'Configuración inicial de la aplicación', 'aria-label del diálogo');
        const bar = ov.querySelector('[role="progressbar"]');
        testRunner.assert(!!bar, 'progressbar presente');
        testRunner.assertEquals(bar.getAttribute('aria-valuenow'), '1', 'arranca en paso 1');
        testRunner.assertEquals(bar.getAttribute('aria-valuemax'), '6', 'máximo 6 pasos');
        ov.querySelector('[data-act="next"]').click();
        testRunner.assertEquals(overlay().querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '2', 'avanza al paso 2');
    },
    'la trampa de foco cicla del último al primero y viceversa'() {
        const box = document.createElement('div');
        box.innerHTML = '<button id="t-a">A</button><button id="t-b">B</button><button id="t-c">C</button>';
        document.body.appendChild(box);
        const [a, , c] = box.querySelectorAll('button');
        c.focus();
        let ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        trapTabKey(ev, box);
        testRunner.assertEquals(document.activeElement.id, 't-a', 'Tab desde el último vuelve al primero');
        testRunner.assertEquals(ev.defaultPrevented, true, 'navegación por defecto cancelada');
        a.focus();
        ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        trapTabKey(ev, box);
        testRunner.assertEquals(document.activeElement.id, 't-c', 'Shift+Tab desde el primero salta al último');
        document.body.removeChild(box);
    },
    'el CSS declina animaciones bajo prefers-reduced-motion'() {
        const css = readFileSync(join(__dirname, '..', '..', 'css', 'onboarding-v2.css'), 'utf8');
        testRunner.assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'bloque prefers-reduced-motion presente');
        testRunner.assert(css.includes('@keyframes glowPulse'), 'keyframe glowPulse definido');
    }
});
