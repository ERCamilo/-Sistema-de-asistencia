/**
 * 📅 ProfilePickers — Date-picker templates used inside the profile modal.
 *
 * Three pickers + one helper:
 *   - ProfileStartDatePicker  / ProfileEndDatePicker — period range
 *   - ProfileHireDatePicker  — change the employee's hire date
 *   - calculateMonthlyEstimate — aligned with PayrollService.calculateEmployeePayroll
 */

import { state } from '../../core/AppState.js';
import { getDaysInMonth, getDateKey, formatMonthYear } from '../../utils/DateUtils.js';

export function ProfileStartDatePicker() {
    const days = getDaysInMonth(state.employeeProfile.startPickerMonth);
    const today = getDateKey(new Date());
    const selected = state.employeeProfile.periodStart;

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
        <div class="date-picker-header">
            <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-app-fn="changeProfileStartMonth" data-arg="-1" data-app-stop="1" aria-label="Mes anterior">◀</button>
            <div class="date-picker-month">${formatMonthYear(state.employeeProfile.startPickerMonth)}</div>
            <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-app-fn="changeProfileStartMonth" data-arg="1" data-app-stop="1" aria-label="Mes siguiente">▶</button>
        </div>
        <div class="date-picker-grid">
            ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
            ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const cls = ['date-picker-day'];
        if (!currentMonth) cls.push('other-month');
        if (dKey === today) cls.push('today');
        if (dKey === selected) cls.push('selected');
        return `<div role="button" tabindex="0" class="${cls.join(' ')}" data-app-fn="selectProfileStartDate" data-arg="${dKey}" data-app-stop="1" aria-label="${dKey}">${date.getDate()}</div>`;
    }).join('')}
        </div>
        <div style="padding: 8px; border-top: 1px solid #334155;">
            <button type="button" data-app-fn="close-start-picker"
                    style="width: 100%; padding: 6px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
                Cerrar
            </button>
        </div>
    </div>`;
}

export function ProfileEndDatePicker() {
    const days = getDaysInMonth(state.employeeProfile.endPickerMonth);
    const today = getDateKey(new Date());
    const selected = state.employeeProfile.periodEnd;

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
        <div class="date-picker-header">
            <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-app-fn="changeProfileEndMonth" data-arg="-1" data-app-stop="1" aria-label="Mes anterior">◀</button>
            <div class="date-picker-month">${formatMonthYear(state.employeeProfile.endPickerMonth)}</div>
            <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-app-fn="changeProfileEndMonth" data-arg="1" data-app-stop="1" aria-label="Mes siguiente">▶</button>
        </div>
        <div class="date-picker-grid">
            ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
            ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const cls = ['date-picker-day'];
        if (!currentMonth) cls.push('other-month');
        if (dKey === today) cls.push('today');
        if (dKey === selected) cls.push('selected');
        return `<div role="button" tabindex="0" class="${cls.join(' ')}" data-app-fn="selectProfileEndDate" data-arg="${dKey}" data-app-stop="1" aria-label="${dKey}">${date.getDate()}</div>`;
    }).join('')}
        </div>
        <div style="padding: 8px; border-top: 1px solid #334155;">
            <button type="button" data-app-fn="close-end-picker"
                    style="width: 100%; padding: 6px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
                Cerrar
            </button>
        </div>
    </div>`;
}

export function ProfileHireDatePicker(emp) {
    if (!state.profileHireDatePickerMonth) {
        state.profileHireDatePickerMonth = new Date(emp.hireDate + 'T00:00:00');
    }
    const days = getDaysInMonth(state.profileHireDatePickerMonth);
    const monthName = state.profileHireDatePickerMonth.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });

    return `<div style="position:relative; margin-top:8px;">
        <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; position:absolute; z-index:100; width:280px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <button type="button" data-app-fn="changeProfileHireDateMonth" data-arg="-1" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;" aria-label="Mes anterior">◀</button>
                <span style="font-size:0.75rem; color:#f1f5f9; font-weight:600; text-transform:capitalize;">${monthName}</span>
                <button type="button" data-app-fn="changeProfileHireDateMonth" data-arg="1" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;" aria-label="Mes siguiente">▶</button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px;">
                ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const isSelected = dKey === emp.hireDate;
        return `<div role="button" tabindex="0" data-app-fn="selectProfileHireDate" data-arg="${emp.id}" data-arg2="${dKey}" aria-label="${dKey}"
                                 style="padding:6px; text-align:center; cursor:pointer; border-radius:4px; font-size:0.7rem; transition:all 0.15s; ${isSelected ? 'background:#06b6d4; color:#000; font-weight:700;' : currentMonth ? 'color:#94a3b8; hover:background:rgba(6,182,212,0.1);' : 'color:#4b5563; opacity:0.4;'}">
                        ${date.getDate()}
                    </div>`;
    }).join('')}
            </div>
        </div>
    </div>`;
}

/**
 * 💰 Monthly salary estimate — aligned with PayrollService.calculateEmployeePayroll
 * so the legacy `baseSalary` field (which could be monthly or daily) is not
 * misinterpreted as an hourly rate.
 */
export function calculateMonthlyEstimate(emp) {
    let totalMonthly = 0;
    const breakdown = [];
    const hoursPerDay = state.settings.regularHoursPerDay || 8;
    const WEEKS_PER_MONTH = 52 / 12; // 4.333...

    emp.positions.forEach(posId => {
        const pos = state.positions.find(p => p.id === posId);
        if (!pos) return;

        // 1. Resolve hourly rate (same priority as PayrollService)
        //    Employee override → position.hourlyRate → legacy salaryConfig
        let hourlyRate = emp.positionSalaries?.[posId] || pos.hourlyRate || 0;

        // 2. Legacy migration: if no hourlyRate but salaryConfig.amount exists,
        //    assume monthly and convert to hourly
        if (!hourlyRate && pos.salaryConfig?.amount) {
            hourlyRate = pos.salaryConfig.amount / 30 / hoursPerDay;
        }

        // 3. Working days
        const workingDays = emp.customWorkingDays?.[posId] || pos.workingDays || [1, 2, 3, 4, 5];
        const daysPerWeek = workingDays.length;

        // 4. Compute: days/week × 4.33 weeks/month × hours/day × $/hour
        const monthlyForPosition = hourlyRate * hoursPerDay * (daysPerWeek * WEEKS_PER_MONTH);
        totalMonthly += monthlyForPosition;
        breakdown.push({
            position: pos.name,
            daysPerWeek,
            hourlyRate,
            monthly: monthlyForPosition
        });
    });

    return { total: totalMonthly, breakdown };
}
