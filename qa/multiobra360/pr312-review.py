"""Independent boundary checks for PR312 application commit 92b49ae2. Loopback demo data only."""
import pathlib, subprocess, socket, time, os, json, hashlib
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'qa/multiobra360/results/pr312-review'
out.mkdir(parents=True,exist_ok=True)
for name in ['unit.json','browser.json','acceptance.json']:
 (out/name).unlink(missing_ok=True)
jobs=[]
def run(label,args,env=None,timeout=120):
 with (out/(label+'.log')).open('w') as log:
  result=subprocess.run(args,cwd=root,env={**os.environ,**(env or {})},stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 jobs.append({'layer':label,'exitCode':result.returncode})
 print(label+' exit='+str(result.returncode),flush=True)
run('unit',['node','node_modules/jest/bin/jest.js','-c','qa/multiobra360/jest.config.cjs','--runInBand','--runTestsByPath','qa/multiobra360/tests/Pr312HolidayFieldIsolation.test.js','--json','--outputFile='+str(out/'unit.json')])
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
emulator=None
errors=[]
try:
 with (out/'firestore.log').open('w') as log:
  emulator=subprocess.Popen([os.environ.get('MULTIOBRA_JAVA','/tmp/sa-firestore-emulator-jre/jdk-21.0.12.1+1-jre/bin/java'),'-jar',os.environ.get('FIRESTORE_EMULATOR_JAR',str(pathlib.Path.home()/'.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar')),'--host','127.0.0.1','--port',str(port),'--project_id','demo-sa-multiobra-pr312'],stdout=log,stderr=subprocess.STDOUT)
  end=time.monotonic()+30
  while True:
   try:
    with socket.create_connection(('127.0.0.1',port),timeout=.5):break
   except OSError:
    if emulator.poll() is not None or time.monotonic()>end:raise RuntimeError('Emulator startup failed')
    time.sleep(.1)
  run('browser',['node','qa/multiobra360/pr312-fields-browser.cjs'],{
   'FIRESTORE_EMULATOR_HOST':'127.0.0.1:'+str(port),
   'SA_EMULATOR_NODE_MODULES':os.environ.get('SA_EMULATOR_NODE_MODULES','/tmp/sa-firestore-emulator-jre/node_modules'),
   'MULTIOBRA_RESULTS':str(out),'MULTIOBRA_POINT':'PR312FIELDS','MULTIOBRA_WIDTHS':'390,1280',
   'MULTIOBRA_AUDIT_PROJECT':'demo-sa-multiobra-pr312-'+str(os.getpid())
  },150)
except (OSError,RuntimeError,subprocess.TimeoutExpired) as exc:
 errors.append(str(exc))
finally:
 if emulator is not None:
  if emulator.poll() is None:emulator.terminate()
  try:emulator.wait(timeout=5)
  except subprocess.TimeoutExpired:emulator.kill();emulator.wait(timeout=5)
def read(name):
 try:return json.loads((out/name).read_text())
 except (OSError,ValueError):errors.append('Missing current '+name);return {}
unit=read('unit.json');browser=read('browser.json')
assertions=[a for suite in unit.get('testResults',[]) for a in suite.get('assertionResults',[])]
if len(assertions)!=5 or any(a.get('status') not in ['passed','failed'] for a in assertions):errors.append('Incomplete unit coverage')
records=browser.get('records',[])
pairs={(r.get('id'),r.get('width')) for r in records}
expected={(case,width) for case in ['pr312-holiday-regular-hours','pr312-holiday-pay-period'] for width in [390,1280]}
if len(records)!=4 or pairs!=expected:errors.append('Incomplete browser cases/widths')
if browser.get('startupErrors') or browser.get('blockedOrigins') or any(r.get('invariantOk') is not True or (r.get('ok') is not True and r.get('kind')!='assertion') for r in records):errors.append('Browser execution/integrity failure')
layers={
 'unit':{'total':len(assertions),'passed':sum(a.get('status')=='passed' for a in assertions),'failed':sum(a.get('status')=='failed' for a in assertions)},
 'browser':{'total':len(records),'passed':sum(r.get('ok') is True for r in records),'failed':sum(r.get('ok') is False for r in records)}
}
totals={k:sum(layer[k] for layer in layers.values()) for k in ['total','passed','failed']}
runtime=['js/modules/features/payroll/ProjectPayrollConfigStore.js','js/modules/features/payroll/ActivePayrollSettings.js','js/modules/features/projects/ProjectCatalogSync.js','js/modules/features/projects/ProjectContext.js']
report={
 'applicationSha':'92b49ae2d20f044896e33bd7f6fb89d187597688',
 'checkoutHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
 'runtimeSha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in runtime},
 'jobs':jobs,'layers':layers,'totals':totals,'infrastructureErrors':errors
}
(out/'acceptance.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2),flush=True)
for rec in records:print(json.dumps({k:rec.get(k) for k in ['id','width','ok','error','invariantOk']},ensure_ascii=False),flush=True)
raise SystemExit(2 if errors else (1 if totals['failed'] else 0))
