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
import { loadDemoDataIntoDB } from '../services/PersistenceService.js';
import icons from './IconSystem.js';

// ============================================
// 🎯 EVENT DELEGATION (data-onb-action)
// ============================================
const _ONB_ACTION_MAP = {
    'next': () => window.onboardingWizard?.next(),
    'prev': () => window.onboardingWizard?.prev(),
    'skip-to-cloud-login': () => window.onboardingWizard?.skipToCloudLogin(),
    'skip-to-restore-backup': () => window.onboardingWizard?.skipToRestoreBackup(),
    'select-mode': (mode) => window.onboardingWizard?.selectMode(mode),
    'save-company-and-next': () => window.onboardingWizard?.saveCompanyAndNext(),
    'complete': () => window.onboardingWizard?.complete(),
    'select-hours': (h) => window.selectHours?.(parseFloat(h)),
    'quick-add-position': (name) => window.quickAddPosition?.(name),
    'remove-position': (id) => window.removePosition?.(id),
    'remove-employee-onboarding': (id) => window.removeEmployeeOnboarding?.(id)
};

function _handleOnbClick(e) {
    const target = e.target.closest('[data-onb-action]');
    if (!target) return;
    const action = target.dataset.onbAction;
    const handler = _ONB_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

function _handleOnbKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-onb-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleOnbClick(e);
}

let _onbDelegationAttached = false;
function _attachOnbDelegation() {
    if (_onbDelegationAttached) return;
    document.addEventListener('click', _handleOnbClick);
    document.addEventListener('keydown', _handleOnbKeydown);
    _onbDelegationAttached = true;
}
_attachOnbDelegation();

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
                    <button type="button" data-onb-action="next" class="btn btn-primary" style="padding: 18px 48px; font-size: 1.25rem; font-weight: 700; box-shadow: 0 10px 30px rgba(6, 182, 212, 0.3);">
                        🚀 Comenzar desde Cero
                    </button>
                    
                    <button type="button" data-onb-action="skip-to-cloud-login" class="btn btn-secondary" style="padding: 14px 36px; font-size: 1rem; font-weight: 600; background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.2)); border: 2px solid #10b981;">
                        ☁️ Ya tengo cuenta en la nube
                    </button>
                    
                    <button type="button" data-onb-action="skip-to-restore-backup" class="btn btn-secondary" style="padding: 14px 36px; font-size: 1rem; font-weight: 600; background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(236, 72, 153, 0.2)); border: 2px solid #8b5cf6;">
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
                    <div role="button" tabindex="0" data-onb-action="select-mode" data-value="demo"
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
                    
                    <div role="button" tabindex="0" data-onb-action="select-mode" data-value="scratch"
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
                    <button type="button" data-onb-action="prev" class="btn btn-secondary" style="padding: 12px 32px;">
                        ← Atrás
                    </button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    async selectMode(mode) {
        state.onboardingMode = mode;
        if (mode === 'demo') {
            // Mostrar indicador de carga en el onboarding
            const container = document.getElementById('onboarding-container') || document.getElementById('app');
            if (container) {
                container.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; gap: 24px;">
                        <div style="font-size: 4rem; animation: bounce 1s ease-in-out infinite;">📊</div>
                        <h2 style="color: #f1f5f9; font-size: 1.5rem;">Cargando datos de prueba...</h2>
                        <p style="color: #94a3b8;">Esto tomará un momento</p>
                        <div style="width: 200px; height: 4px; background: #1e293b; border-radius: 4px; overflow: hidden;">
                            <div style="width: 100%; height: 100%; background: linear-gradient(90deg, #06b6d4, #10b981); animation: loading-bar 1.5s ease-in-out infinite;"></div>
                        </div>
                    </div>
                    <style>
                        @keyframes loading-bar {
                            0% { transform: translateX(-100%); }
                            100% { transform: translateX(100%); }
                        }
                    </style>
                `;
            }

            try {
                await this.loadDemoData();
                state.onboardingStep = this.steps.indexOf('done');
            } catch (error) {
                console.error('❌ Error cargando modo demo:', error);
                Notification.error('Error al cargar datos de prueba');
            }
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

    async loadDemoData() {
        try {
            await loadDemoDataIntoDB();
            debug.log('📊 Datos de prueba avanzados cargados y persistidos en IndexedDB');
        } catch (error) {
            console.error('❌ Error al cargar datos demo:', error);
            Notification.error('Error al cargar los datos de prueba');
        }
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
                    <button type="button" data-onb-action="prev" class="btn btn-secondary" style="flex: 1;">← Atrás</button>
                    <button type="button" data-onb-action="save-company-and-next" class="btn btn-primary" style="flex: 2;">Siguiente →</button>
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
                        <button type="button" data-onb-action="select-hours" data-value="${h}" style="padding: 32px 16px; border-radius: 16px; border: 3px solid ${state.settings.regularHoursPerDay === h ? '#06b6d4' : '#334155'}; background: #1e293b; color: #f1f5f9; cursor: pointer;">
                            <div style="font-size: 2.5rem; font-weight: 900;">${h}</div>
                            <div style="font-size: 0.875rem; color: #94a3b8;">horas</div>
                        </button>
                    `).join('')}
                </div>
                
                <div style="display: flex; gap: 12px;">
                    <button type="button" data-onb-action="prev" class="btn btn-secondary" style="flex: 1;">← Atrás</button>
                    <button type="button" data-onb-action="next" class="btn btn-primary" style="flex: 2;">Siguiente →</button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    renderPositions() {
        const positionsCount = state.positions.filter(p => p.active).length;
        const activePositions = state.positions.filter(p => p.active);

        return `
            <div style="padding: 40px 20px; max-width: 800px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 3.5rem; margin-bottom: 16px;">🎯</div>
                    <h2 style="font-size: 1.75rem; color: #f1f5f9; font-weight: 800; margin-bottom: 8px;">Paso 3: Cargos y Salarios</h2>
                    <p style="color: #94a3b8;">Define los roles de tu equipo (se pueden editar luego)</p>
                </div>
                
                <div style="background: rgba(30, 41, 59, 0.5); border-radius: 16px; padding: 24px; border: 1px solid #334155; margin-bottom: 32px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 16px; text-transform: uppercase; font-weight: 700;">Sugerencias rápidas:</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px;">
                        ${['Maestro', 'Albañil', 'Carpintero', 'Varillero', 'Ayudante', 'Sereno'].map(name => `
                            <button type="button" data-onb-action="quick-add-position" data-value="${name}"
                                    class="btn-tag" 
                                    style="padding: 8px 16px; background: #0f172a; border: 1px solid #1e293b; color: #94a3b8; border-radius: 20px; cursor: pointer; transition: all 0.2s;">
                                + ${name}
                            </button>
                        `).join('')}
                    </div>

                    ${activePositions.length > 0 ? `
                        <div style="display: grid; gap: 10px; margin-top: 24px;">
                            ${activePositions.map(pos => `
                                <div style="display: flex; align-items: center; justify-content: space-between; background: #0f172a; padding: 12px 16px; border-radius: 12px; border-left: 4px solid ${pos.color};">
                                    <div>
                                        <div style="font-weight: 700; color: #f1f5f9;">${pos.name}</div>
                                        <div style="font-size: 0.75rem; color: #64748b;">$${pos.salaryConfig.amount.toLocaleString()}/${pos.salaryConfig.period === 'month' ? 'mes' : 'día'}</div>
                                    </div>
                                    <button type="button" data-onb-action="remove-position" data-id="${pos.id}" aria-label="Eliminar posición" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.25rem;">&times;</button>
                                </div>
                            `).join('')}
                        </div>
                    ` : `
                        <div style="text-align: center; padding: 20px; color: #475569; border: 2px dashed #1e293b; border-radius: 12px;">
                            Agrega al menos un cargo para continuar
                        </div>
                    `}
                </div>
                
                <div style="display: flex; gap: 12px;">
                    <button type="button" data-onb-action="prev" class="btn btn-secondary" style="flex: 1; padding: 14px;">← Atrás</button>
                    <button type="button" data-onb-action="next" class="btn btn-primary" style="flex: 2; padding: 14px;" ${activePositions.length === 0 ? 'disabled' : ''}>Siguiente →</button>
                </div>
                ${this.renderProgress()}
            </div>
        `;
    }

    renderEmployees() {
        const activeEmployees = state.employees.filter(e => e.active);
        const activePositions = state.positions.filter(p => p.active);

        return `
            <div style="padding: 40px 20px; max-width: 800px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="font-size: 3.5rem; margin-bottom: 16px;">👥</div>
                    <h2 style="font-size: 1.75rem; color: #f1f5f9; font-weight: 800; margin-bottom: 8px;">Paso 4: Tu Equipo</h2>
                    <p style="color: #94a3b8;">Agrega a los trabajadores actuales</p>
                </div>

                <div style="background: rgba(30, 41, 59, 0.5); border-radius: 16px; padding: 24px; border: 1px solid #334155; margin-bottom: 32px;">
                    <form onsubmit="window.addOnboardingEmployee(event)" style="display: grid; gap: 12px; margin-bottom: 24px;">
                        <input type="text" id="onboarding-emp-name" placeholder="Nombre completo" required 
                               style="padding: 14px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; color: white;">
                        
                        <select id="onboarding-emp-position" required 
                                style="padding: 14px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; color: white;">
                            <option value="">Selecciona un cargo...</option>
                            ${activePositions.map(pos => `<option value="${pos.id}">${pos.name}</option>`).join('')}
                        </select>
                        
                        <button type="submit" class="btn btn-primary" style="padding: 14px; background: #10b981;">+ Agregar al equipo</button>
                    </form>

                    ${activeEmployees.length > 0 ? `
                        <div style="display: grid; gap: 10px; border-top: 1px solid #1e293b; padding-top: 20px;">
                            ${activeEmployees.map(emp => {
                                const pos = state.positions.find(p => p.id === emp.positionId);
                                return `
                                    <div style="display: flex; align-items: center; justify-content: space-between; background: #0f172a; padding: 12px 16px; border-radius: 12px;">
                                        <div>
                                            <div style="font-weight: 700; color: #f1f5f9;">${emp.name}</div>
                                            <div style="font-size: 0.75rem; color: #64748b;">${pos ? pos.name : 'Sin cargo'}</div>
                                        </div>
                                        <button type="button" data-onb-action="remove-employee-onboarding" data-id="${emp.id}" style="background: none; border: none; color: #ef4444; cursor: pointer;">Borrar</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div style="display: flex; gap: 12px;">
                    <button type="button" data-onb-action="prev" class="btn btn-secondary" style="flex: 1; padding: 14px;">← Atrás</button>
                    <button type="button" data-onb-action="next" class="btn btn-primary" style="flex: 2; padding: 14px;" ${activeEmployees.length === 0 ? 'disabled' : ''}>Finalizar Configuración →</button>
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
                <button type="button" data-onb-action="complete" class="btn btn-primary" style="padding: 20px 64px; font-size: 1.25rem;">
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
        localStorage.setItem('onboardingCompleted', 'true');
        if (state.onboardingMode === 'scratch') {
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
        // Crear un input de archivo temporal
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (window.loadBackupFromFile) {
                // Marcar como completado antes de cargar para que no vuelva a aparecer
                localStorage.setItem('onboardingCompleted', 'true');
                state.showOnboarding = false;
                
                window.loadBackupFromFile(file);
                // Notification se encarga del mensaje
            } else {
                console.error('❌ loadBackupFromFile no está disponible globalmente');
                if (window.Notification) window.Notification.error('Error: Sistema de restauración no listo');
            }
        };
        
        input.click();
    }
}

export const onboardingWizard = new OnboardingWizard();
window.onboardingWizard = onboardingWizard;

// ⚡ HELPERS GLOBALES (Mantenidos para handlers HTML onclick)
window.selectHours = function (hours) {
    state.settings.regularHoursPerDay = hours;
    render();
};

window.quickAddPosition = function (name) {
    const colors = ['#10b981', '#f59e0b', '#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899'];
    const existingPos = state.positions.find(p => p.name === name && p.active);

    if (existingPos) {
        if (window.Notification) window.Notification.error(`La posición "${name}" ya existe`);
        return;
    }

    const newPosition = {
        id: generateUUID(),
        name: name,
        salaryConfig: {
            amount: 30000,
            period: 'month',
            workDays: [1, 2, 3, 4, 5, 6]
        },
        color: colors[state.positions.length % colors.length],
        leaderId: null,
        active: true,
        updatedAt: Date.now()
    };

    state.positions.push(newPosition);
    if (window.Notification) window.Notification.success(`Posición "${name}" agregada`);
    render();
};

window.removePosition = function (positionId) {
    state.positions = state.positions.filter(p => p.id !== positionId);
    render();
};

window.addOnboardingEmployee = function (event) {
    if (event) event.preventDefault();

    const nameInput = document.getElementById('onboarding-emp-name');
    const positionSelect = document.getElementById('onboarding-emp-position');

    if (!nameInput || !positionSelect) return;

    const name = nameInput.value.trim();
    const positionId = positionSelect.value;

    if (!name || !positionId) {
        if (window.Notification) window.Notification.error('Por favor ingresa nombre y cargo');
        return;
    }

    const newEmployee = {
        id: generateUUID(),
        name: name,
        number: String(state.employees.length + 1).padStart(3, '0'),
        positionId: positionId,
        positions: [positionId],
        active: true,
        joinedAt: Date.now(),
        updatedAt: Date.now()
    };

    state.employees.push(newEmployee);
    nameInput.value = '';
    
    if (window.Notification) window.Notification.success(`Empleado "${name}" agregado`);
    render();
};
window.removeEmployeeOnboarding = function (empId) {
    state.employees = state.employees.filter(e => e.id !== empId);
    render();
};
