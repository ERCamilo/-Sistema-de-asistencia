import { Modal } from '../../components/Modal.js';
import { COLOR_PALETTE } from '../../utils/Constants.js';
import { getState, context } from '../../features/employees/EmployeesUI.js';
import icons from '../../ui/IconSystem.js';
import { slugify, generateUUID } from '../../utils/Helpers.js';
import { HelpTooltip } from '../../components/HelpTooltip.js';

export class PositionModal {
    static open(positionId = null) {
        const state = getState();
        const pos = positionId ? state.positions.find(p => p.id === positionId) : null;
        const isEdit = !!pos;
        const mainTitle = isEdit ? 'Editar Posición' : 'Nueva Posición';
        const subtitle = isEdit ? pos.name : null;
        const title = isEdit ? mainTitle : mainTitle; // Mantener variable title por si se usa abajo (en el objeto modal)

        const activeLeaders = state.leaders.filter(l => l.active);
        const selectedColor = pos?.color || COLOR_PALETTE[0];

        const hourlyRate = pos?.hourlyRate || '';
        const regularHours = state.settings.regularHoursPerDay || 8;
        const overtimeFactor = state.settings.overtimeFactor || 1.5;
        const holidayFactor = state.settings.holidayFactor || 2;

        const contentHTML = `
            <div style="max-height: 70vh; overflow-y: auto; padding-right: 8px;">
                <div class="form-group">
                    <label class="form-label">📝 Nombre de la Posición *</label>
                    <input type="text" id="posName" class="form-input" value="${pos?.name || ''}" placeholder="Ej: Albañil" required>
                </div>
                
                <!-- ⚡ SISTEMA SIMPLE: SOLO TARIFA POR HORA -->
                <div style="background: #1e293b; padding: 16px; border-radius: 12px; margin: 16px 0; border: 1px solid #334155;">
                    <h3 style="font-size: 1rem; color: #06b6d4; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                        💰 Configuración de Pago
                    </h3>
                    
                    <div class="form-group">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            ⏱️ Tarifa por Hora *
                            ${HelpTooltip.render('position.hourlyRate')}
                        </label>
                        <input type="number" inputmode="decimal"
                               id="posHourlyRate"
                               class="form-input"
                               value="${hourlyRate}"
                               placeholder="150"
                               min="1"
                               step="1"
                               data-help-on-focus="position.hourlyRate"
                               required>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">
                            💡 Ingresa cuánto cobra por cada hora trabajada
                        </div>
                    </div>
                    
                    <!-- PREVIEW DE TARIFAS -->
                    <div id="hourlyRatePreview" style="background: #0f172a; padding: 12px; border-radius: 8px; margin-top: 12px; border: 1px solid #334155;">
                        <!-- Se llenará dinámicamente -->
                    </div>
                </div>

                <!-- ⚡ SELECTOR DE DÍAS LABORALES -->
                <div style="background: #1e293b; padding: 16px; border-radius: 12px; margin: 16px 0; border: 1px solid #334155;">
                    <h3 style="font-size: 1rem; color: #06b6d4; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                        📅 Días Laborales
                        ${HelpTooltip.render('position.workingDays')}
                    </h3>
                    <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 12px;">
                        Selecciona qué días de la semana trabaja esta posición por defecto
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px;">
                        ${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day, idx) => {
                            const isChecked = pos?.workingDays?.includes(idx) ?? (idx >= 1 && idx <= 5);
                            return `
                                <label class="working-day-label" style="display: flex; flex-direction: column; align-items: center; cursor: pointer; padding: 8px; background: ${isChecked ? 'rgba(6,182,212,0.2)' : '#0f172a'}; border: 2px solid ${isChecked ? '#06b6d4' : '#334155'}; border-radius: 8px; transition: all 0.2s;">
                                    <input type="checkbox" 
                                           name="workingDay" 
                                           value="${idx}" 
                                           ${isChecked ? 'checked' : ''}
                                           style="margin-bottom: 6px;">
                                    <span style="font-size: 0.7rem; color: ${isChecked ? '#06b6d4' : '#94a3b8'}; font-weight: ${isChecked ? '700' : '500'};">${day}</span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                    <div style="font-size: 0.7rem; color: #64748b; margin-top: 12px;">
                        💡 Esto se usa para calcular el salario mensual estimado (días/sem × 4.333 × horas/día)
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                        👑 Líder/Encargado (Opcional)
                        ${HelpTooltip.render('position.leader')}
                    </label>
                    <select id="posLeader" class="form-select">
                        <option value="">Sin líder asignado</option>
                        ${activeLeaders.map(ldr => `
                            <option value="${ldr.id}" ${pos?.leaderId === ldr.id ? 'selected' : ''}>
                                ${ldr.number} - ${ldr.name}
                            </option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">🎨 Color Identificador</label>
                    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 12px;" id="posColorContainer">
                        ${COLOR_PALETTE.map(color => `
                            <label style="cursor: pointer; position: relative;">
                                <input type="radio" name="posColor" value="${color}" ${selectedColor === color ? 'checked' : ''} style="position: absolute; opacity: 0;">
                                <div class="color-swatch ${selectedColor === color ? 'selected' : ''}" style="width: 100%; aspect-ratio: 1; border-radius: 12px; background: ${color}; border: 4px solid ${selectedColor === color ? '#06b6d4' : 'transparent'}; transition: all 0.2s;"></div>
                            </label>
                        `).join('')}
                    </div>
                </div>
                
                ${isEdit ? `
                    <div class="modal-info" style="margin-top: 16px;">
                        <div class="info-row" style="display: flex; justify-content: space-between; padding: 12px; background: #0f172a; border-radius: 8px;">
                            <span class="info-label" style="color: #94a3b8;">Empleados:</span>
                            <span class="info-value" style="color: #fff; font-weight: 600;">${state.employees.filter(e => e.positions && e.positions.includes(pos.id) && e.active).length}</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        const modal = new Modal({
            title: `🎯 ${mainTitle}`,
            subtitle: subtitle,
            content: contentHTML,
            size: 'medium',
            buttons: [
                { text: 'Cancelar', class: 'btn-secondary', onClick: function() { this.close(); } },
                { text: '💾 Guardar', class: 'btn-primary', onClick: function() { PositionModal.save(this, pos); } }
            ]
        });

        // Abrir modal y anexar en el navegador
        modal.open();
        
        // Listeners Locales (DOM recién inyectado)
        const rateInput = modal.element.querySelector('#posHourlyRate');
        const checkboxes = modal.element.querySelectorAll('input[name="workingDay"]');
        const colorRadios = modal.element.querySelectorAll('input[name="posColor"]');
        
        const updatePreviewHandler = () => PositionModal.updatePreview(modal.element, state);

        if (rateInput) {
            rateInput.addEventListener('input', updatePreviewHandler);
        }

        checkboxes.forEach(cb => {
            cb.addEventListener('change', (e) => {
                const label = e.target.closest('label');
                if (e.target.checked) {
                    label.style.background = 'rgba(6,182,212,0.2)';
                    label.style.borderColor = '#06b6d4';
                    label.querySelector('span').style.color = '#06b6d4';
                    label.querySelector('span').style.fontWeight = '700';
                } else {
                    label.style.background = '#0f172a';
                    label.style.borderColor = '#334155';
                    label.querySelector('span').style.color = '#94a3b8';
                    label.querySelector('span').style.fontWeight = '500';
                }
                updatePreviewHandler();
            });
        });

        colorRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                modal.element.querySelectorAll('.color-swatch').forEach(sw => sw.style.borderColor = 'transparent');
                const swatch = e.target.nextElementSibling;
                swatch.style.borderColor = '#06b6d4';
            });
        });

        // Trigger inicial del preview
        updatePreviewHandler();
    }

    static updatePreview(modalEl, state) {
        const hourlyRateInput = modalEl.querySelector('#posHourlyRate');
        if (!hourlyRateInput) return;

        const hourlyRate = Number.parseFloat(hourlyRateInput.value) || 0;
        const regularHours = state.settings.regularHoursPerDay || 8;
        const overtimeFactor = state.settings.overtimeFactor || 1.5;
        const holidayFactor = state.settings.holidayFactor || 2;
        
        const workingDaysInputs = modalEl.querySelectorAll('input[name="workingDay"]:checked');
        const daysPerWeek = workingDaysInputs.length || 5;

        const dailyRate = hourlyRate * regularHours;
        const WeeksRate = dailyRate * daysPerWeek;
        const monthlyRate = WeeksRate * 4.333;
        const twoWeeksRate = WeeksRate * 2;
        const threeWeeksRate = WeeksRate * 3;
        const overtimeRate = hourlyRate * overtimeFactor;
        const holidayRate = hourlyRate * holidayFactor;

        const previewContainer = modalEl.querySelector('#hourlyRatePreview');
        if (previewContainer) {
            previewContainer.innerHTML = `
                <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px;">📊 Tarifas Calculadas:</div>
                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.875rem;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">🕐 Por hora (regular):</span>
                        <span style="color: #10b981; font-weight: 600;">$${Math.round(hourlyRate).toLocaleString()}/h</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">📅 Por día (${regularHours}h):</span>
                        <span style="color: #06b6d4; font-weight: 600;">$${Math.round(dailyRate).toLocaleString()}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">📅 1 semana:</span>
                        <span style="color: #64748b; font-weight: 600;">~$${Math.round(WeeksRate).toLocaleString()}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">📅 Por 2 semanas:</span>
                        <span style="color: #64748b; font-weight: 600;">~$${Math.round(twoWeeksRate).toLocaleString()}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">📅 Por 3 semanas:</span>
                        <span style="color: #64748b; font-weight: 600;">~$${Math.round(threeWeeksRate).toLocaleString()}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">📅 Por mes (est. mensual):</span>
                        <span style="color: #64748b; font-weight: 600;">~$${Math.round(monthlyRate).toLocaleString()}</span>
                    </div>
                    <div style="border-top: 1px solid #334155; margin: 4px 0; padding-top: 8px;"></div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">⚡ Horas extras (${overtimeFactor}x):</span>
                        <span style="color: #3b82f6; font-weight: 600;">$${Math.round(overtimeRate).toLocaleString()}/h</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">☀️ Días festivos (${holidayFactor}x):</span>
                        <span style="color: #f59e0b; font-weight: 600;">$${Math.round(holidayRate).toLocaleString()}/h</span>
                    </div>
                </div>
                <div style="font-size: 0.7rem; color: #64748b; margin-top: 8px;">
                    💡 Los factores se configuran en Ajustes
                </div>
            `;
        }
    }

    static save(modalInstance, existingPos) {
        const el = modalInstance.element;
        const name = el.querySelector('#posName').value.trim();
        const rate = parseFloat(el.querySelector('#posHourlyRate').value);
        const leaderId = el.querySelector('#posLeader').value;
        const color = el.querySelector('input[name="posColor"]:checked')?.value || COLOR_PALETTE[0];
        const workingDays = Array.from(el.querySelectorAll('input[name="workingDay"]:checked')).map(cb => parseInt(cb.value));

        if (!name) {
            window.showAlert('El nombre de la posición es obligatorio', 'error');
            return;
        }

        if (isNaN(rate) || rate < 0) {
            window.showAlert('La tarifa por hora debe ser un número válido >= 0', 'error');
            return;
        }

        const state = getState();
        // ⚡ Opción A (IDs estables): el id del puesto NO se deriva del nombre.
        // La unicidad se valida por nombre (slug), pero el id es inmutable, así
        // que renombrar actualiza el MISMO documento en la nube (sin duplicar
        // ni dejar huérfanos en la subcolección positions/{id}).
        const nameSlug = slugify(name);
        const duplicate = state.positions.find(
            p => slugify(p.name) === nameSlug && (!existingPos || p.id !== existingPos.id)
        );
        if (duplicate) {
            window.showAlert('Ya existe una posición con este nombre', 'error');
            return;
        }

        if (existingPos) {
            const posToEdit = state.positions.find(p => p.id === existingPos.id);
            if (posToEdit) {
                // El id permanece estable; renombrar solo cambia el nombre y los
                // campos. No hay que migrar referencias porque el id no cambia.
                posToEdit.name = name;
                posToEdit.hourlyRate = rate;
                posToEdit.leaderId = leaderId || null;
                posToEdit.color = color;
                posToEdit.workingDays = workingDays;
                posToEdit.updatedAt = Date.now();
                posToEdit._isDirty = true;

                window.showAlert(`${icons.get('check-circle')} Posición "${name}" actualizada`, 'success');
            }
        } else {
            state.positions.push({
                id: generateUUID(),
                name: name,
                hourlyRate: rate,
                workingDays: workingDays,
                leaderId: leaderId || null,
                color: color,
                active: true,
                updatedAt: Date.now(),
                _isDirty: true
            });
            window.showAlert(`${icons.get('check-circle')} Posición "${name}" creada correctamente`, 'success');
        }

        context.saveToLocalStorage();
        context.render();
        modalInstance.close();
    }
}
