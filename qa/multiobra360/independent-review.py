"""Run isolated multiobra regression cases. Exit 0=accepted, 1=assertions, 2=incomplete/environment."""
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import time

root = pathlib.Path(__file__).resolve().parents[2]
out = pathlib.Path(os.environ.get('MULTIOBRA_REVIEW_RESULTS', str(root / 'qa/multiobra360/results/independent-review')))
out.mkdir(parents=True, exist_ok=True)
jobs, infrastructure = [], []
expected_browser = {
    (case, width)
    for case in [
        'review-post-read-account-switch', 'review-post-read-detached-restore',
        'review-refresh-same-project', 'review-control-current-refresh',
        'review-seed-versus-edit', 'review-failed-write-ui'
    ]
    for width in [390, 1280]
}
# Never use a JSON result from a previous run after a process fails to start.
for name in ['unit.json', 'emulator.json', 'browser.json', 'run.json', 'acceptance.json']:
    (out / name).unlink(missing_ok=True)
runtime = [
    'js/modules/features/projects/ProjectCatalogSync.js',
    'js/modules/features/projects/ProjectContext.js',
    'js/modules/features/payroll/ActivePayrollSettings.js',
    'js/modules/features/payroll/ProjectPayrollConfigStore.js'
]
environment = {
    'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'runtimeSha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in runtime}
}
(out / 'environment.json').write_text(json.dumps(environment, indent=2))

def run(label, args, env=None, timeout=120):
    code, error = None, None
    try:
        with (out / (label + '.log')).open('w') as log:
            code = subprocess.run(
                args, cwd=root, env={**os.environ, **(env or {})},
                stdout=log, stderr=subprocess.STDOUT, timeout=timeout
            ).returncode
    except (OSError, subprocess.TimeoutExpired) as exc:
        error = str(exc)
        infrastructure.append(label + ': ' + error)
    jobs.append({'label': label, 'exitCode': code, 'error': error})
    if code not in (0, 1) and error is None:
        infrastructure.append(label + ': abnormal exit ' + str(code))
    print(label + ' exit=' + str(code), flush=True)

def jest(label, file, config, env=None):
    run(label, [
        'node', 'node_modules/jest/bin/jest.js', '-c', config,
        '--runInBand', '--runTestsByPath', file,
        '--json', '--outputFile=' + str(out / (label + '.json'))
    ], env, 150)

emulator, emulator_log = None, None
try:
    jest('unit', 'qa/multiobra360/tests/IndependentBoundaryReview.test.js', 'qa/multiobra360/jest.config.cjs')
    java = os.environ.get('MULTIOBRA_JAVA', '/tmp/sa-firestore-emulator-jre/jdk-21.0.12.1+1-jre/bin/java')
    jar = os.environ.get('FIRESTORE_EMULATOR_JAR', str(pathlib.Path.home() / '.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar'))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    emulator_log = (out / 'firestore.log').open('w')
    emulator = subprocess.Popen([
        java, '-jar', jar, '--host', '127.0.0.1', '--port', str(port),
        '--project_id', 'demo-sa-multiobra-review'
    ], stdout=emulator_log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 30
    while True:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.5):
                break
        except OSError:
            if emulator.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('Firestore emulator failed to start')
            time.sleep(.1)
    env = {
        'FIRESTORE_EMULATOR_HOST': '127.0.0.1:' + str(port),
        'SA_EMULATOR_NODE_MODULES': os.environ.get('SA_EMULATOR_NODE_MODULES', '/tmp/sa-firestore-emulator-jre/node_modules'),
        'MULTIOBRA_RESULTS': str(out), 'MULTIOBRA_POINT': 'REVIEW',
        'MULTIOBRA_WIDTHS': '390,1280',
        'MULTIOBRA_AUDIT_PROJECT': 'demo-sa-multiobra-review-' + str(os.getpid())
    }
    jest('emulator', 'qa/multiobra360/tests/emulator/IndependentTransactionReview.emulator.test.js',
         'qa/multiobra360/jest.emulator.config.cjs', env)
    run('browser', ['node', 'qa/multiobra360/browser.cjs'], env, 150)
except (OSError, RuntimeError) as exc:
    infrastructure.append(str(exc))
finally:
    if emulator is not None:
        if emulator.poll() is None:
            emulator.terminate()
        try:
            emulator.wait(timeout=5)
        except subprocess.TimeoutExpired:
            emulator.kill()
            emulator.wait(timeout=5)
    if emulator_log is not None:
        emulator_log.close()

def read(name):
    try:
        return json.loads((out / name).read_text())
    except (OSError, ValueError) as exc:
        infrastructure.append(name + ': missing or invalid current result')
        return None

summary = {}
for label, expected in [('unit', 11), ('emulator', 3)]:
    data = read(label + '.json')
    if data is None:
        continue
    assertions = [a for suite in data.get('testResults', []) for a in suite.get('assertionResults', [])]
    passed = sum(a.get('status') == 'passed' for a in assertions)
    failed = sum(a.get('status') == 'failed' for a in assertions)
    if (len(assertions) != expected or passed + failed != expected
            or len({a.get('fullName') for a in assertions}) != expected
            or data.get('numRuntimeErrorTestSuites', 0)
            or any(suite.get('testExecError') for suite in data.get('testResults', []))):
        infrastructure.append(label + ': incomplete, duplicated, skipped or runtime-error cases')
    summary[label] = {'total': len(assertions), 'passed': passed, 'failed': failed}
data = read('browser.json')
if data is not None:
    records = data.get('records', [])
    pairs = [(r.get('id'), r.get('width')) for r in records]
    if len(pairs) != 12 or set(pairs) != expected_browser:
        infrastructure.append('browser: missing or duplicated scenario/viewport pairs')
    if (data.get('startupErrors') or data.get('blockedOrigins')
            or any((r.get('ok') is not True and r.get('kind') != 'assertion') or r.get('invariantOk') is not True for r in records)):
        infrastructure.append('browser: infrastructure error or data integrity not verified')
    summary['browser'] = {
        'total': len(records), 'passed': sum(r.get('ok') is True for r in records),
        'failed': sum(r.get('ok') is False for r in records)
    }
if {job['label'] for job in jobs} != {'unit', 'emulator', 'browser'}:
    infrastructure.append('not all required stages completed')
for job in jobs:
    if job['exitCode'] == 1 and summary.get(job['label'], {}).get('failed', 0) == 0:
        infrastructure.append(job['label'] + ': process failed without completed failed assertions')
totals = {key: sum(layer[key] for layer in summary.values()) for key in ['total', 'passed', 'failed']}
code = 2 if infrastructure else (1 if totals['failed'] else 0)
attestation = {
    'schemaVersion': 1, 'eligible': code == 0, 'expectedTotal': 26,
    'totals': totals, 'layers': summary, 'infrastructureErrors': infrastructure, 'exitCode': code
}
(out / 'run.json').write_text(json.dumps({'environment': environment, 'jobs': jobs}, indent=2))
(out / 'acceptance.json').write_text(json.dumps(attestation, indent=2))
print(json.dumps(attestation, ensure_ascii=False, indent=2), flush=True)
print('Evidence: ' + str(out), flush=True)
raise SystemExit(code)
