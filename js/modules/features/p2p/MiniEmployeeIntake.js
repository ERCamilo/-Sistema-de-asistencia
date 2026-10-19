import '../../../p2p/MiniEmployeeProposal.js';
import { entityInScope } from '../projects/ProjectContext.js';
import { sameEmployeeNumber } from '../employees/EmployeeNumberIdentity.js';
import { normalizePersonName } from '../projects/ProjectDuplicateCandidates.js';
import { dailyToHourly, hourlyToDaily } from '../payroll/SalaryConversion.js';
import { rankMiniAttendanceEmployeeSuggestions } from '../attendance/MiniAttendanceDraft.js';
import { getDateKey, parseDate } from '../../utils/DateUtils.js';

export const proposalContract = globalThis.MiniEmployeeProposal;
const idOf = value => String(value ?? '').trim();
const live = (entity, scope) => entity && !entity.deletedAt && entityInScope(entity, scope);

export function intakeSuggestions(row, employees, scope) {
    const eligible=employees.filter(e=>live(e,scope));
    const similar=new Set(rankMiniAttendanceEmployeeSuggestions({rawNumber:row.number,rawName:row.name,employees:eligible,limit:5}).filter(c=>c.nameScore>=.88).map(c=>c.employee.id));
    const nameKey=name=>normalizePersonName(name).split(' ').sort().join(' ');
    return eligible.filter(e=>sameEmployeeNumber(e.number,row.number)||nameKey(e.name)===nameKey(row.name)||similar.has(e.id));
}

export function intakeReviewVersion({ employees = [], positions = [] }, scope, hoursPerDay) {
    const order = records => records.sort((a,b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify([scope.projectId, hoursPerDay,
        order(employees.filter(e => live(e,scope)).map(e=>[e.id,e.number,e.name,e.active,e.updatedAt,e.positions,e.positionSalaries,e.phone,e.email])),
        order(positions.filter(p=>live(p,scope)).map(p=>[p.id,p.name,p.hourlyRate,p.active,p.updatedAt]))]);
}

export function buildEmployeeIntakePlan(raw, decisions, {
    scope, employees = [], positions = [], hoursPerDay, now = Date.now(),
    createId = kind => `${kind}-${crypto.randomUUID()}`
}) {
    const proposal = proposalContract.validateProposal(raw);
    if (!scope?.enabled || scope.projectId !== proposal.saProjectId) throw new Error('La obra cambió. Vuelve a revisar el personal.');
    if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 24) throw new Error('Revisa las horas de jornada de SA.');
    const edits = new Map(decisions.map(d => [d.miniLocalId, d]));
    if (edits.size !== decisions.length || decisions.some(d => !proposal.employees.some(e => e.miniLocalId === d.miniLocalId))) throw new Error('Decisiones de personal inválidas.');
    const writes = [], positionWrites = [], mappings = [], pending = [], targets = new Set();
    const available = employees.filter(e => live(e, scope));
    const availablePositions = positions.filter(p => live(p, scope));
    const today = getDateKey(new Date(now));
    for (const source of proposal.employees) {
        const choice = edits.get(source.miniLocalId);
        if (!choice || choice.action === 'pending') { pending.push(source.miniLocalId); continue; }
        if (!['create','link'].includes(choice.action)) throw new Error('Elige crear, vincular o dejar pendiente.');
        let target = choice.action === 'link' ? available.find(e => e.id === choice.employeeId) : null;
        const wasPaused = target?.active === false;
        let reviewedPositionId = null;
        if (choice.action === 'link' && !target) throw new Error('El empleado elegido ya no pertenece a esta obra.');
        if (target && target.active === false && choice.reactivate !== true) throw new Error('Confirma la reactivación del empleado pausado.');
        if (!target || choice.update === true) {
            const values = { ...source, ...choice.fields, miniLocalId: source.miniLocalId };
            const reviewed = proposalContract.validateProposal({ ...proposal, employees: [values] }).employees[0];
            if (!reviewed.position || reviewed.dailySalary === null) throw new Error('Completa puesto y salario diario antes de aceptar.');
            if (available.concat(writes).some(e => e.id !== target?.id && sameEmployeeNumber(e.number, reviewed.number))) throw new Error(`La ficha ${reviewed.number} ya está ocupada. Vincula al empleado correcto o cambia la ficha.`);
            const homonyms = intakeSuggestions(reviewed,available.concat(writes).filter(e=>e.id!==target?.id),scope);
            if (!target && homonyms.length && choice.confirmDifferent !== true) throw new Error('Hay un posible duplicado. Confirma si es la misma persona o personas distintas.');
            let position = choice.positionId && choice.positionId !== 'new' ? availablePositions.find(p => p.id === choice.positionId) : null;
            if (choice.positionId && choice.positionId !== 'new' && !position) throw new Error('El puesto elegido ya no está disponible.');
            if (!position) {
                const sameName = availablePositions.filter(p => normalizePersonName(p.name) === normalizePersonName(reviewed.position));
                if (sameName.length === 1 && choice.positionId !== 'new') position = sameName[0];
                else if (sameName.length) throw new Error('Ese puesto ya existe: elige cuál usar.');
                else {
                    position = positionWrites.find(p => normalizePersonName(p.name) === normalizePersonName(reviewed.position));
                    if (!position) {
                        const id = createId('pos');
                        position = {id,key:id,name:reviewed.position,hourlyRate:dailyToHourly(reviewed.dailySalary,hoursPerDay),active:true,projectId:scope.projectId,workingDays:[1,2,3,4,5],updatedAt:now,_isDirty:true};
                        positionWrites.push(position);
                    }
                }
            }
            if (position.active === false) throw new Error('El puesto está pausado. Reactívalo en Puestos o elige otro antes de aceptar.');
            const id = target?.id || createId('emp');
            let birth = {};
            if (!target) {
                const hireDate = choice.hireDate || today;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate) || getDateKey(parseDate(hireDate)) !== hireDate || hireDate > today) throw new Error('Revisa la fecha de ingreso; debe ser una fecha válida hasta hoy.');
                birth = {hireDate,createdDate:new Date(now).toISOString(),statusHistory:[{date:hireDate,active:true,timestamp:now}]};
            }
            reviewedPositionId = position.id;
            target = { ...(target || {}),...birth,id,key:target?.key || id,number:reviewed.number,name:reviewed.name,phone:reviewed.phone,email:reviewed.email,
                positions:[...new Set([...(target?.positions || []),position.id])],
                positionSalaries:{...target?.positionSalaries,[position.id]:dailyToHourly(reviewed.dailySalary,hoursPerDay)},
                positionSalaryModes:{...target?.positionSalaryModes,[position.id]:'daily'},active:true,projectId:scope.projectId,updatedAt:now,positionsUpdatedAt:now,_isDirty:true };
            writes.push(target);
        } else if (target.active === false) {
            target = {...target,active:true,updatedAt:now,_isDirty:true}; writes.push(target);
        }
        if (wasPaused) {
            target.lastStatusChange = today;
            target.statusHistory = [...(target.statusHistory || []),{date:today,active:true,timestamp:now}];
        }
        if (targets.has(target.id)) throw new Error('El mismo empleado fue elegido para dos filas. Deja una pendiente para revisar el duplicado en Mini.');
        targets.add(target.id);
        const positionId = reviewedPositionId || (choice.positionId && choice.positionId !== 'new' ? choice.positionId : target.positions?.[0]);
        const position = availablePositions.concat(positionWrites).find(p => p.id === positionId);
        const hourly = target.positionSalaries?.[positionId] ?? position?.hourlyRate;
        mappings.push({miniLocalId:source.miniLocalId,saEmployeeId:target.id,number:idOf(target.number),name:target.name,position:position?.name || '',dailySalary:Number.isFinite(Number(hourly)) && Number(hourly)>0 ? Math.round(hourlyToDaily(Number(hourly),hoursPerDay)*100)/100 : null,phone:target.phone || '',email:target.email || ''});
    }
    const result = proposalContract.validateResult({schema:'mini-roster-result/v1',proposalId:proposal.proposalId,saProjectId:proposal.saProjectId,mappings},proposal);
    return {employees:writes,positions:positionWrites,mappings:result.mappings,pending,result};
}
