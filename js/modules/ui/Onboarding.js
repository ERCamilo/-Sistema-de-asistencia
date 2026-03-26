/**
 * 🚀 ONBOARDING WIZARD (Fase 3 - Modularización)
 * Gestiona el flujo de bienvenida y configuración inicial del sistema.
 */
console.log('🔍 DEBUG: Onboarding.js cargado');

import { state } from '../core/AppState.js';
import { render } from '../core/RenderManager.js';
import { saveApplicationData } from '../services/PersistenceService.js';
import { FirebaseService } from '../services/index.js';
import { generateUUID } from '../utils/Helpers.js';
import { Notification } from '../components/Notification.js';
import { debug } from '../utils/Debug.js';
import { demoData, generateDemoAttendance } from '../data/DemoData.js';
import icons from './IconSystem.js';

class OnboardingWizard {
    constructor() {
        this.steps = [
            'welcome',
            'mode-selection',
            'company',
            'hours',
            'positions',
            'employees',
            'done'
        ];
    }

    show() {
        // Solo mostrar si no está en modo demo Y no ha completado onboarding
        if (!state.usingDemoData && !localStorage.getItem('onboardingCompleted')) {
            state.showOnboarding = true;
            state.onboardingStep = 0;
            render();
        }
    }

    renderStep() {
        const step = this.steps[state.onboardingStep];

        switch (step) {
            case 'welcome': return this.renderWelcome();
            case 'mode-selection': return this.renderModeSelection();
            case 'company': return this.renderCompany();
            case 'hours': return this.renderHours();
            case 'positions': return this.renderPositions();
            case 'employees': return this.renderEmployees();
            case 'done': return this.renderDone();
            default: return '';
        }
    }

    renderWelcome() {
        return `
            <div style="text-align: center; padding: 60px 40px;">
                <div style="font-size: 5rem; margin-bottom: 24px; animation: bounce 2s ease-in-out infinite;">👷‍♂️</div>
                <h1 style="font-size: 2.5rem; margin-bottom: 16px; background: linear-gradient(135deg, #06b6d4, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 900;">
                    ¡Bienvenido a Control de Asistencia!
                </h1>
                <p style="font-size: 1.25rem; color: #94a3b8; margin-bottom: 40px; max-width: 600px; margin-left: auto; margin-right: auto; line-height: 1.6;">
                    Sistema profesional para gestionar la asistencia de tu equipo de construcción
                </p>
                
                <div style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-radius: 16px; padding: 32px; margin-bottom: 40px; max-width: 500px; margin-left: auto; margin-right: auto; border: 1px solid rgba(6, 182, 212, 0.2);">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Lo que puedes hacer:</div>
                    <div style="display: grid; gap: 12px; text-align: left;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="background: #10b981; width: 8px; height: 8px; border-radius: 50%;"></div>
                            <span style="color: #f1f5f9; font-size: 0.875rem;">Registrar asistencia diaria</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="background: #06b6d4; width: 8px; height: 8px; border-radius: 50%;"></div>
                            <span style="color: #f1f5f9; font-size: 0.875rem;">Gestionar horas extras y festivos</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="background: #f59e0b; width: 8px; height: 8px; border-radius: 50%;"></div>
                            <span style="color: #f1f5f9; font-size: 0.875rem;">Generar reportes y exportar a Excel</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="background: #8b5cf6; width: 8px; height: 8px; border-radius: 50%;"></div>
                            <span style="color: #f1f5f9; font-size: 0.875rem;">Sincronizar en la nube (Firebase)</span>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 16px; max-width: 400px; margin: 0 auto;">
                    <button onclick="onboardingWizard.next()" class="btn btn-primary" style="padding: 18px 48px; font-size: 1.25rem; font-weight: 700; box-shadow: 0 10px 30px rgba(6, 182, 212, 0.3);">
                        🚀 Comenzar desde Cero
                    </button>
                    
                    <button onclick="onboardingWizard.skipToCloudLogin()" class="btn btn-secondary" style="padding: 14px 36px; font-size: 1rem; font-weight: 600; background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2)); border: 2px solid #10b981;">
                        ☁️ Ya tengo cuenta en la nube
                    </button>
                    
                    <button onclick="onboardingWizard.skipToRestoreBackup()" class="btn btn-secondary" style="padding: 14px 36px; font-size: 1rem; font-weight: 600; background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(236, 72, 153, 0.2)); border: 2px solid #8b5cf6;">
                        💾 Restaurar desde Backup
                    </button>
                </div>
                
                ${this.renderProgress()}
            </div>
        `;
    }

    renderModeSelection() {
        return `
            <div style="padding: 20px; max-width: 900px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h2 style="font-size: 1.5rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">¿Cómo quieres comenzar?</h2>
                    <p style="color: #94a3b8; font-size: 1rem;">Elige la opción que mejor se adapte a ti</p>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 20px; margin-bottom: 24px;">
                    <div onclick="onboardingWizard.selectMode('demo')" 
                         style="background: linear-gradient(135deg, #1e293b, #0f172a); 
                                border: 2px solid #06b6d4; 
                                border-radius: 16px; 
                                padding: 24px; 
                                cursor: pointer; 
                                transition: all 0.3s; 
                                position: relative;">
                        
                        <div style="position: absolute; top: 12px; right: 12px; 
                                   background: linear-gradient(135deg, #06b6d4, #0891b2); 
                                   color: white; 
                                   padding: 4px 10px; 
                                   border-radius: 8px; 
                                   font-size: 0.65rem; 
                                   font-weight: 700;">
                            RECOMENDADO
                        </div>
                        
                        <div style="font-size: 3rem; margin-bottom: 12px; text-align: center;">🎮</div>
                        <h3 style="font-size: 1.25rem; margin-bottom: 8px; color: #06b6d4; font-weight: 700; text-align: center;">
                            Explorar con Datos de Prueba
                        </h3>
                        <p style="color: #94a3b8; margin-bottom: 16px; line-height: 1.5; text-align: center; font-size: 0.875rem;">
                            Perfecto para conocer el sistema
                        </p>
                        
                        <div style="background: rgba(6, 182, 212, 0.1); border-radius: 10px; padding: 14px; margin-bottom: 14px; border-left: 3px solid #06b6d4;">
                            <div style="font-size: 0.8rem; color: #f1f5f9; line-height: 1.6;">
                                <div style="margin-bottom: 6px;">✓ 5 empleados de ejemplo</div>
                                <div style="margin-bottom: 6px;">✓ 3 posiciones configuradas</div>
                                <div style="margin-bottom: 6px;">✓ Asistencia de últimos 7 días</div>
                            </div>
                        </div>
                    </div>
                    
                    <div onclick="onboardingWizard.selectMode('scratch')" 
                         style="background: linear-gradient(135deg, #1e293b, #0f172a); 
                                border: 2px solid #334155; 
                                border-radius: 16px; 
                                padding: 24px; 
                                cursor: pointer; 
                                transition: all 0.3s;">
                        
                        <div style="font-size: 3rem; margin-bottom: 12px; text-align: center;">🚀</div>
                        <h3 style="font-size: 1.25rem; margin-bottom: 8px; color: #10b981; font-weight: 700; text-align: center;">
                            Configurar Desde Cero
                        </h3>
                        <p style="color: #94a3b8; margin-bottom: 16px; line-height: 1.5; text-align: center; font-size: 0.875rem;">
                            Para empezar con tus datos reales
                        </p>
                        <div style="background: rgba(16, 185, 129, 0.1); border-radius: 10px; padding: 14px; margin-bottom: 14px; border-left: 3px solid #10b981;">
                            <div style="font-size: 0.8rem; color: #f1f5f9; line-height: 1.6;">
                                <div style="margin-bottom: 6px;">✓ Configuración guiada paso a paso</div>
                                <div style="margin-bottom: 6px;">✓ Tus datos se guardan permanentemente</div>
                                <div style="margin-bottom: 6px;">✓ Listo para producción</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div style="text-align: center;">
                    <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="padding: 12px 32px;">
                        ← Atrás
                    </button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    selectMode(mode) {
        state.onboardingMode = mode;
        if (mode === 'demo') {
            this.loadDemoData();
            state.onboardingStep = this.steps.indexOf('done');
        } else if (mode === 'scratch') {
            this.clearAllData();
            this.next();
        }
        render();
    }

    clearAllData() {
        state.positions = [];
        state.leaders = [];
        state.employees = [];
        state.attendance = {};
        state.settings = {
            companyName: 'Mi Empresa',
            regularHoursPerDay: 8,
            holidayFactor: 2,
            iconSet: resolveIconSet(),
            holidays: []
        };
        state.dayHoursConfig = {};
    }

    loadDemoData() {
        state.usingDemoData = true;
        state.settings = { ...demoData.settings };
        // state.settings.iconSet = resolveIconSet(state.settings.iconSet);
        // applyIconSet(state.settings.iconSet);
        state.positions = JSON.parse(JSON.stringify(demoData.positions));
        state.employees = JSON.parse(JSON.stringify(demoData.employees));
        state.attendance = generateDemoAttendance();
        debug.log('📊 Datos de prueba cargados (NO guardados)');
    }

    renderCompany() {
        return `
            <div style="padding: 60px 40px; max-width: 600px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 40px;">
                    <div style="font-size: 4rem; margin-bottom: 20px;">🏗️</div>
                    <h2 style="font-size: 2rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">Paso 1: Tu Empresa</h2>
                    <p style="color: #94a3b8; font-size: 1.125rem;">¿Cómo se llama tu constructora?</p>
                </div>
                
                <div style="margin-bottom: 40px;">
                    <input 
                        type="text" 
                        id="onboarding-company-name"
                        placeholder="Ej: Constructora El Progreso"
                        value="${state.settings.companyName}"
                        style="width: 100%; padding: 16px; font-size: 1.125rem; border-radius: 12px; border: 2px solid #334155; background: #0f172a; color: #f1f5f9; transition: all 0.2s;"
                        onfocus="this.style.borderColor='#06b6d4'"
                        onblur="this.style.borderColor='#334155'"
                    >
                </div>
                
                <div style="display: flex; gap: 12px; justify-content: space-between;">
                    <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">← Atrás</button>
                    <button onclick="onboardingWizard.saveCompanyAndNext()" class="btn btn-primary" style="flex: 2;">Siguiente →</button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    renderHours() {
        return `
            <div style="padding: 60px 40px; max-width: 700px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 40px;">
                    <div style="font-size: 4rem; margin-bottom: 20px;">⏰</div>
                    <h2 style="font-size: 2rem; margin-bottom: 12px; color: #f1f5f9; font-weight: 800;">Paso 2: Jornada Laboral</h2>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 40px;">
                    ${[6, 8, 9, 10].map(h => `
                        <button onclick="window.selectHours(${h})" style="padding: 32px 16px; border-radius: 16px; border: 3px solid ${state.settings.regularHoursPerDay === h ? '#06b6d4' : '#334155'}; background: #1e293b; color: #f1f5f9; cursor: pointer;">
                            <div style="font-size: 2.5rem; font-weight: 900;">${h}</div>
                            <div style="font-size: 0.875rem; color: #94a3b8;">horas</div>
                        </button>
                    `).join('')}
                </div>
                
                <div style="display: flex; gap: 12px;">
                    <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">← Atrás</button>
                    <button onclick="onboardingWizard.next()" class="btn btn-primary" style="flex: 2;">Siguiente →</button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    renderPositions() {
        const positionsCount = state.positions.filter(p => p.active).length;
        return `
            <div style="padding: 60px 40px; max-width: 800px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 40px;">
                    <div style="font-size: 4rem; margin-bottom: 20px;">🎯</div>
                    <h2 style="font-size: 2rem; color: #f1f5f9; font-weight: 800;">Paso 3: Posiciones</h2>
                </div>
                
                <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px;">
                    ${['Ayudante', 'Albañil', 'Carpintero', 'Electricista'].map(name => `
                        <button onclick="window.quickAddPosition('${name}')" class="btn btn-secondary">+ ${name}</button>
                    `).join('')}
                </div>
                
                <div style="display: flex; gap: 12px;">
                    <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">← Atrás</button>
                    <button onclick="onboardingWizard.next()" class="btn btn-primary" style="flex: 2;" ${positionsCount === 0 ? 'disabled' : ''}>Siguiente →</button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    renderEmployees() {
        const employeesCount = state.employees.filter(e => e.active).length;
        return `
            <div style="padding: 60px 40px; max-width: 800px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 40px;">
                    <div style="font-size: 4rem; margin-bottom: 20px;">👥</div>
                    <h2 style="font-size: 2rem; color: #f1f5f9; font-weight: 800;">Paso 4: Empleados</h2>
                </div>
                
                <div style="display: flex; gap: 12px;">
                    <button onclick="onboardingWizard.prev()" class="btn btn-secondary" style="flex: 1;">← Atrás</button>
                    <button onclick="onboardingWizard.next()" class="btn btn-primary" style="flex: 2;" ${employeesCount === 0 ? 'disabled' : ''}>Siguiente →</button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    renderDone() {
        const isDemo = state.onboardingMode === 'demo';
        return `
            <div style="text-align: center; padding: 60px 40px; max-width: 700px; margin: 0 auto;">
                <div style="font-size: 5rem; margin-bottom: 32px;">🎉</div>
                <h1 style="font-size: 2.5rem; margin-bottom: 16px; background: linear-gradient(135deg, #06b6d4, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 900;">
                    ${isDemo ? '¡Modo Exploración!' : '¡Todo Listo!'}
                </h1>
                <button onclick="onboardingWizard.complete()" class="btn btn-primary" style="padding: 20px 64px; font-size: 1.25rem;">
                    🚀 Empezar →
                </button>
                ${this.renderProgress()}
            </div>
        `;
    }

    renderProgress() {
        const total = this.steps.length;
        const current = state.onboardingStep + 1;
        const percentage = (current / total) * 100;
        return `
            <div style="margin-top: 48px; text-align: center;">
                <div style="background: #334155; height: 8px; border-radius: 4px; overflow: hidden; max-width: 400px; margin: 0 auto 12px;">
                    <div style="background: linear-gradient(90deg, #06b6d4, #10b981); height: 100%; width: ${percentage}%;"></div>
                </div>
            </div>
        `;
    }

    next() {
        if (state.onboardingStep < this.steps.length - 1) {
            state.onboardingStep++;
            render();
        }
    }

    prev() {
        if (state.onboardingStep > 0) {
            state.onboardingStep--;
            render();
        }
    }

    saveCompanyAndNext() {
        const input = document.getElementById('onboarding-company-name');
        if (input) {
            state.settings.companyName = input.value.trim();
            this.next();
        }
    }

    complete() {
        if (state.onboardingMode === 'scratch') {
            localStorage.setItem('onboardingCompleted', 'true');
            saveApplicationData();
        }
        state.showOnboarding = false;
        render();
    }

    skipToCloudLogin() {
        localStorage.setItem('onboardingCompleted', 'true');
        state.showOnboarding = false;
        render();
        setTimeout(() => FirebaseService.loginWithGoogle(), 200);
    }

    skipToRestoreBackup() {
        localStorage.setItem('onboardingCompleted', 'true');
        state.showOnboarding = false;
        render();
        // Lógica de backup...
    }
}

export const onboardingWizard = new OnboardingWizard();
window.onboardingWizard = onboardingWizard;
