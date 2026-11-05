import { confirmProjectAction } from '../modules/features/projects/ProjectActionDialog.js';
import { mountProjectList, renderProjectItemHTML } from '../modules/features/projects/ProjectListUI.js';
import { attachProjectDialogA11y } from '../modules/features/projects/ProjectDialogA11y.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
afterEach(() => { document.querySelector('[data-project-action-cancel]')?.click(); document.querySelector('[data-project-action-confirm]')?.click(); document.body.innerHTML = ''; });
test.each(['close','reopen','archive','unarchive','request','cancel','delete'])('%s requires confirmation and explains the action', async action => {
 const result = confirmProjectAction(action, { name: '<Obra>' });
 const dialog = document.querySelector('[role="dialog"]');
 expect(dialog.textContent).toContain('<Obra>');
 expect(dialog.querySelector('svg')).not.toBeNull();
 expect(dialog.querySelector('#project-action-description').textContent.length).toBeGreaterThan(30);
 document.querySelector('[data-project-action-confirm]').click();
 expect(await result).toBe(true);
});
test('Escape closes only the top confirmation, restores focus, writes nothing', async () => {
 document.body.innerHTML = '<div id="parent"><section role="dialog" aria-modal="true"><button id="trigger">Pausar</button></section></div>';
 const parentEscape = jest.fn();
 const detach = attachProjectDialogA11y(document.getElementById('parent'), {onEscape:parentEscape,focusInitial:false});
 document.getElementById('trigger').focus();
 const result = confirmProjectAction('close',{name:'Torre'});
 await tick();
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 expect(await result).toBe(false);
 expect(parentEscape).not.toHaveBeenCalled();
 await tick();expect(document.activeElement.id).toBe('trigger');detach();
});
test('Tab cycles within confirmation and backdrop cancels', async () => {
 const result=confirmProjectAction('close',{name:'Torre'});await tick();
 const buttons=[...document.querySelectorAll('.project-action-dialog button')];
 buttons[1].focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 expect(document.activeElement).toBe(buttons[0]);
 document.querySelector('.project-action-overlay').click();expect(await result).toBe(false);
});
test('status change is not called on cancel or double click and waits for confirmation',async()=>{
 document.body.innerHTML='<div id="list"></div>';
 const project={id:'B',name:'Torre',status:'active'};
 const service={transitionProjectStatus:jest.fn(async()=>({state:{projects:[{...project,status:'closed'}]}}))};
 mountProjectList(document.getElementById('list'),{projects:[project],allowSwitch:true,setupService:service});
 let button=document.querySelector('[data-project-status-action]');
 button.click();button.click();expect(document.querySelectorAll('.project-action-dialog')).toHaveLength(1);
 document.querySelector('[data-project-action-cancel]').click();await tick();
 expect(service.transitionProjectStatus).not.toHaveBeenCalled();
 document.querySelector('[data-project-status-action]').click();
 expect(service.transitionProjectStatus).not.toHaveBeenCalled();
 document.querySelector('[data-project-action-confirm]').click();await tick();
 expect(service.transitionProjectStatus).toHaveBeenCalledTimes(1);
 expect(service.transitionProjectStatus).toHaveBeenCalledWith('B','close');
});
test('warning appears only after requesting deletion impact, never in menu',async()=>{
 document.body.innerHTML='<div id="list"></div>';
 const project={id:'B',name:'Torre',status:'closed',closedAt:Date.now()};
 const usage={B:{verified:true,empty:false,employees:2}};
 const service={getProjectUsage:async()=>usage,previewProjectDeletion:jest.fn(async()=>({blockers:[{kind:'employees',count:2}]}))};
 mountProjectList(document.getElementById('list'),{projects:[project],allowSwitch:true,setupService:service});
 await tick();expect(document.body.textContent).not.toContain('Esta obra conserva historial y relaciones.');
 document.querySelector('[data-project-impact]').click();await tick();
 expect(document.querySelector('.project-action-dialog').textContent).toContain('Esta obra conserva historial y relaciones.');
 expect(service.previewProjectDeletion).toHaveBeenCalledWith('B');
});
test('different states remain visible with icon and text',()=>{
 for(const [status,label] of [['active','Activa'],['closed','Pausada'],['archived','Archivado']]){
 const html=renderProjectItemHTML({id:'B',name:'Torre',status});
 expect(html).toContain('data-project-status="'+status+'"');expect(html).toContain(label);expect(html).toContain('<svg');
 }
});
