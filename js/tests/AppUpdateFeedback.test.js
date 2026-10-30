import { createUpdateFeedback, updateUpdateFeedback, showUpdateSuccess } from '../modules/ui/AppUpdateFeedback.js';
afterEach(()=>{document.body.innerHTML='';jest.useRealTimers();});
test('unknown downloads animate without announcing an invented percentage',()=>{
 const el=createUpdateFeedback();document.body.append(el);
 updateUpdateFeedback(el,{activity:'download',phase:'preparing'});
 expect(el.dataset.activity).toBe('download');
 expect(el.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
 expect(el.querySelector('svg')).not.toBeNull();
});
test('known file counts are presented accurately and installing stays indeterminate',()=>{
 const el=createUpdateFeedback();
 updateUpdateFeedback(el,{activity:'download',progress:{completed:12,total:40}});
 expect(el.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('12');
 expect(el.querySelector('[role="progressbar"]').getAttribute('aria-valuemax')).toBe('40');
 expect(el.textContent).toContain('12 de 40 archivos');
 expect(el.querySelector('[role="progressbar"]').getAttribute('aria-valuetext')).toBe('12 de 40 archivos');
 updateUpdateFeedback(el,{activity:'install',busy:true});
 expect(el.dataset.activity).toBe('install');
 expect(el.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
});
test('invalid or stale counts cannot become progress percentages',()=>{
 const el=createUpdateFeedback();
 for(const progress of [{completed:41,total:40},{completed:-1,total:40},{completed:2,total:0},{completed:NaN,total:40}]){
  updateUpdateFeedback(el,{activity:'download',progress});
  expect(el.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
 }
});
test('success renders the Mini check once and leaves without another acceptance',()=>{
 jest.useFakeTimers();const closed=jest.fn();
 showUpdateSuccess(closed);
 const success=document.getElementById('update-success');
 expect(success.hidden).toBe(false);expect(success.getAttribute('role')).toBe('status');
 expect(success.querySelector('svg circle')).not.toBeNull();
 expect(success.querySelector('button')).toBeNull();
 jest.advanceTimersByTime(1800);
 expect(success.hidden).toBe(true);expect(closed).toHaveBeenCalledTimes(1);
});
