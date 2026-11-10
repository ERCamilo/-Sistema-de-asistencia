import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { projectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import * as repair from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { projectConflictArchiveStore } from '../modules/features/projects/ProjectConflictArchive.js';
import {
  buildReconciliationOutcomeCases,
  openProjectReconciliation, closeProjectReconciliation, registerProjectReconciliationGlobals
} from '../modules/features/projects/ProjectReconciliationUI.js';

const project = { id: 'PRJ-action-main', name: 'Obra principal', status: 'active' };
const orphan = n => ({ id: 'emp-'+n, number: String(n), name: 'Persona '+n, positions: [], projectId: 'missing-work' });
const click = (action, parent = document) => parent.querySelector('[data-r07-action="'+action+'"]')?.click();
const change = (selector, value) => {
  const e = document.querySelector(selector);
  if (e.type === 'radio') e.checked = true;
  else e.value = value;
  e.dispatchEvent(new Event('change', { bubbles: true }));
};
const settle = async () => { for (let i=0;i<14;i++) await new Promise(resolve=>setTimeout(resolve,0)); };
describe('Bloque A tarjetas accionables: #351 y #352', () => {
  let setup, read, apply;
  beforeEach(()=>{
    document.body.innerHTML = '';
    setProjectsEnabled(true);
    read = jest.spyOn(indexedDBService,'getAll').mockResolvedValue([]);
    setup = jest.spyOn(projectSetupService,'getState').mockResolvedValue({
      enabled:true, ready:true, activeProjectId:project.id,
      defaultProjectId:project.id, projects:[project]
    });
    state.employees=[orphan(34),orphan(405)];
    state.positions=[];state.leaders=[];state.attendance={};
    apply=jest.spyOn(repair,'applyOwnershipRepair').mockImplementation(async()=>{
      state.employees[0].projectId=project.id;
      return {status:repair.REPAIR_STATUS.OK,cloudQueued:false};
    });
    registerProjectReconciliationGlobals();
  });
  afterEach(()=>{closeProjectReconciliation();jest.restoreAllMocks();document.body.innerHTML='';});
  const prepare=async()=>{
    await openProjectReconciliation();
    change('[name="r07-recon-action"][value="map"]');
    change('[data-r07-control="target-project"]',project.id);
    click('quick-assign');click('apply');await settle();
  };
  test('A08: pending results list each remaining employee with level, reason, recommendation and direct action',async()=>{
    await prepare();
    const cards=document.querySelectorAll('[data-r07-result-case]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('405');
    expect(cards[0].textContent).toMatch(/Motivo:/);
    expect(cards[0].textContent).toMatch(/Recomendaci[oó]n:/);
    expect(cards[0].querySelector('[data-r07-case-risk]')).not.toBeNull();
    expect(cards[0].querySelector('[data-r07-action="result-review-case"]')).not.toBeNull();
    click('result-review-case',cards[0]);
    expect(document.querySelector('[data-r07-result]')).toBeNull();
    expect(document.querySelector('.r07-wizard-content').textContent).toContain('405');
    expect(apply).toHaveBeenCalledTimes(1);
  });
  test('A09: postpone and archive demand a warning before applying; postpone must not alter records',async()=>{
    await prepare();
    const card=document.querySelector('[data-r07-result-case]');
    click('result-defer-case',card);
    const dialog=document.querySelector('[data-r07-outcome-confirm]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toMatch(/seguir[aá].*pendiente|permanece pendiente/i);
    expect(state.employees[1].projectId).toBe('missing-work');
    click('result-confirm-cancel');
    expect(document.querySelector('[data-r07-outcome-confirm]')).toBeNull();
    click('result-defer-case',document.querySelector('[data-r07-result-case]'));
    expect(document.querySelector('[data-r07-outcome-confirm]')).not.toBeNull();
    click('result-confirm-defer');
    expect(document.querySelector('[data-r07-result-case] .r07-recon-hint').textContent)
      .toMatch(/dejado para luego/i);
    expect(state.employees[1].projectId).toBe('missing-work');
  });
  test('A10: high/critical financial inconsistency recommends review, never offers direct archive when critical',()=>{
    const cases=buildReconciliationOutcomeCases({
      pendingCases:[{id:'diagnostic-payments:pay-1'}],
      diagnosticIssues:[{kind:'payments',key:'pay-1',label:'Pago de préstamo',reason:'La obra original del pago no está disponible'}],
      diagnosticReadErrors:[]
    });
    expect(cases).toHaveLength(1);
    expect(cases[0].risk).toBe('critical');
    expect(cases[0].recommendation).toMatch(/revis/i);
    expect(cases[0].canArchive).toBe(false);
  });
  test('A12: archive asks confirmation and uses reversible archive store without changing the employee', async()=>{
    const stored=[];
    jest.spyOn(projectConflictArchiveStore,'list').mockImplementation(async()=>stored);
    const save=jest.spyOn(projectConflictArchiveStore,'setCase').mockImplementation(async(item, opts)=>{
      if(opts.archived) stored.push({id:item.id,reason:item.reason,status:'archived',archivedAt:Date.now()});
    });
    await prepare();
    const card=document.querySelector('[data-r07-result-case]');
    expect(card.querySelector('[data-r07-action="result-archive-case"]')).not.toBeNull();
    click('result-archive-case',card);
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector('[data-r07-outcome-confirm]').textContent).toMatch(/no resuelve|no borra/i);
    click('result-confirm-archive');
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-r07-result-case]')).toBeNull();
    expect(document.querySelector('[data-r07-result]').textContent).toMatch(/archivad.*sin corregir/i);
    expect(state.employees[1].projectId).toBe('missing-work');
  });
  test('A13: user-controlled diagnostic HTML is escaped in risk cards',()=>{
    const cases=buildReconciliationOutcomeCases({
      pendingCases:[{id:'diagnostic-configs:bad'}],
      diagnosticIssues:[{kind:'configs',key:'bad',label:'<img src=x onerror=alert(1)>',reason:'<script>bad</script>'}]
    });
    expect(cases[0].title).toContain('<img');
    expect(cases[0].risk).toBe('medium');
    expect(cases[0].canArchive).toBe(true);
  });
  test('A11: read errors are high priority and do not become repairable or archiveable',()=>{
    const cards=buildReconciliationOutcomeCases({diagnosticReadErrors:['payrollClosures']});
    expect(cards[0].risk).toMatch(/high|critical/);
    expect(cards[0].canArchive).toBe(false);
    expect(cards[0].action).toBe('retry-read');
  });
});
