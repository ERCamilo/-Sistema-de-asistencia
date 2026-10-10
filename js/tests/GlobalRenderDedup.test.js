import { state, stateManager, renderOptimizer } from '../modules/core/AppState.js';
import { render, setRootComponent } from '../modules/core/RenderManager.js';
import { eventBus } from '../modules/core/Events.js';
import { EmployeeFloatingCard } from '../modules/ui/components/EmployeeFloatingCard.js';

let frames, component, completed, unsubscribe;

beforeEach(() => {
    jest.useFakeTimers({ now: 10000 });
    frames = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length; });
    renderOptimizer._renderQueue.length = 0;
    renderOptimizer._rendering = false;
    renderOptimizer._lastRender = 0;
    document.body.innerHTML = '<div id="root"></div>';
    window.render = render;
    window._systemAlerts = null;
    window.ScrollService = null;
    Object.assign(stateManager.getState(), {
        activeTab: 'attendance', showFloatingCard: false,
        employees: [{ id: 'emp-1', name: 'Empleado' }]
    });
    component = jest.fn(() => `<p>${state.activeTab}</p>`);
    setRootComponent(component);
    completed = jest.fn();
    unsubscribe = eventBus.on('render:complete', completed);
});

afterEach(() => {
    unsubscribe();
    setRootComponent(null);
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
});

function flushFrames() {
    for (let step = 0; step < 20; step++) {
        jest.advanceTimersByTime(20);
        const batch = frames.splice(0);
        batch.forEach(cb => cb());
        if (!frames.length && !jest.getTimerCount() && !renderOptimizer._renderQueue.length) return;
    }
    throw new Error('Render queue did not settle');
}

test.each(['proxy-first', 'explicit-first'])('state and explicit render coalesce (%s)', order => {
    if (order === 'explicit-first') render();
    state.activeTab = 'employees';
    render();
    flushFrames();
    expect(component).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(document.getElementById('root').textContent).toBe('employees');
});

test('multiple direct calls and batched state changes produce one render', () => {
    render();
    render();
    stateManager.batchSetState(() => { state.activeTab = 'settings'; });
    render();
    flushFrames();
    expect(component).toHaveBeenCalledTimes(1);
    expect(document.getElementById('root').textContent).toBe('settings');
});

test('opening the employee floating card produces one render', () => {
    EmployeeFloatingCard.open('emp-1');
    flushFrames();
    expect(component).toHaveBeenCalledTimes(1);
    expect(state.showFloatingCard).toBe(true);
});

test('a state change during rendering gets a subsequent render', () => {
    component.mockImplementationOnce(() => {
        state.activeTab = 'employees';
        return '<p>initial</p>';
    });
    render();
    flushFrames();
    expect(component).toHaveBeenCalledTimes(2);
    expect(document.getElementById('root').textContent).toBe('employees');
});

test('later frames can render again and idle time does not render', () => {
    render();
    flushFrames();
    jest.advanceTimersByTime(5000);
    expect(component).toHaveBeenCalledTimes(1);
    state.activeTab = 'settings';
    flushFrames();
    expect(component).toHaveBeenCalledTimes(2);
});

test('identical primitive state updates and an empty update do not render', () => {
    const raw = stateManager.getState();
    raw.renderAuditNaN = NaN;
    stateManager.setState({ activeTab: 'attendance', renderAuditNaN: NaN });
    stateManager.setState({});
    state.renderAuditNaN = NaN;
    flushFrames();
    expect(component).not.toHaveBeenCalled();
    stateManager.setState({ activeTab: 'employees' });
    flushFrames();
    expect(component).toHaveBeenCalledTimes(1);
    expect(document.getElementById('root').textContent).toBe('employees');
    delete raw.renderAuditNaN;
});

test('deleting a missing property does not render, while deleting an existing undefined value does', () => {
    const raw = stateManager.getState();
    raw.renderAuditObject = { present: undefined };
    expect(delete state.renderAuditObject.missing).toBe(true);
    flushFrames();
    expect(component).not.toHaveBeenCalled();
    expect(delete state.renderAuditObject.present).toBe(true);
    flushFrames();
    expect(component).toHaveBeenCalledTimes(1);
    expect(Object.hasOwn(raw.renderAuditObject, 'present')).toBe(false);
    delete raw.renderAuditObject;
});

test('adding an undefined property is a real update for both state APIs', () => {
    const raw = stateManager.getState();
    delete raw.renderAuditUndefined;
    stateManager.setState({ renderAuditUndefined: undefined });
    flushFrames();
    expect(component).toHaveBeenCalledTimes(1);
    delete raw.renderAuditUndefined;
    state.renderAuditUndefined = undefined;
    flushFrames();
    expect(component).toHaveBeenCalledTimes(2);
    delete raw.renderAuditUndefined;
});

test('replacing object state still unwraps proxies and renders the new snapshot', () => {
    const raw = stateManager.getState();
    raw.renderAuditObject = { value: 'old' };
    const incoming = state.renderAuditObject;
    stateManager.setState({ renderAuditObject: incoming });
    flushFrames();
    expect(component).toHaveBeenCalledTimes(1);
    expect(raw.renderAuditObject).toEqual({ value: 'old' });
    expect(raw.renderAuditObject._isProxy).toBeUndefined();
    expect(raw.renderAuditObject).not.toBe(incoming._rawTarget);
    delete raw.renderAuditObject;
});

test('a failed render does not prevent subsequent requests', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    component.mockImplementationOnce(() => { throw new Error('render failed'); });
    render();
    flushFrames();
    expect(error).toHaveBeenCalled();
    render();
    flushFrames();
    expect(component).toHaveBeenCalledTimes(2);
    expect(document.getElementById('root').textContent).toBe('attendance');
});
