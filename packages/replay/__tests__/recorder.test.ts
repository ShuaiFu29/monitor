import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventRecorder } from '../src/recorder';
import { NodeIdManager } from '../src/snapshot';
import { Sanitizer } from '../src/sanitizer';
import type { UserInteractionEvent } from '@monitor/types';

describe('EventRecorder', () => {
  let idManager: NodeIdManager;
  let sanitizer: Sanitizer;
  let events: UserInteractionEvent[];
  let recorder: EventRecorder;
  let container: HTMLDivElement;

  beforeEach(() => {
    idManager = new NodeIdManager();
    sanitizer = new Sanitizer({ maskAllInputs: true });
    events = [];
    container = document.createElement('div');
    container.id = 'recorder-test';
    document.body.appendChild(container);

    // Pre-assign ID
    idManager.getId(container);

    recorder = new EventRecorder(
      (event) => { events.push(event); },
      idManager,
      sanitizer,
      {
        mouseMoveThrottle: 10,
        scrollThrottle: 10,
        touchMoveThrottle: 10,
      },
    );
  });

  afterEach(() => {
    recorder.stop();
    if (container.parentNode) {
      document.body.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('should start and stop recording', () => {
    expect(recorder.isActive()).toBe(false);
    recorder.start(document);
    expect(recorder.isActive()).toBe(true);
    recorder.stop();
    expect(recorder.isActive()).toBe(false);
  });

  it('should not start twice', () => {
    recorder.start(document);
    recorder.start(document); // No-op
    expect(recorder.isActive()).toBe(true);
  });

  it('should record click events', () => {
    recorder.start(document);

    const clickEvent = new MouseEvent('click', {
      clientX: 100,
      clientY: 200,
      bubbles: true,
    });
    container.dispatchEvent(clickEvent);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('click');
    expect(events[0].x).toBe(100);
    expect(events[0].y).toBe(200);
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('should record dblclick events', () => {
    recorder.start(document);

    const dblclickEvent = new MouseEvent('dblclick', {
      clientX: 50,
      clientY: 75,
      bubbles: true,
    });
    container.dispatchEvent(dblclickEvent);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('dblclick');
    expect(events[0].x).toBe(50);
    expect(events[0].y).toBe(75);
  });

  it('should record mousemove events', async () => {
    recorder.start(document);

    const moveEvent = new MouseEvent('mousemove', {
      clientX: 150,
      clientY: 250,
      bubbles: true,
    });
    document.dispatchEvent(moveEvent);

    // Wait for throttle
    await new Promise((resolve) => setTimeout(resolve, 20));

    const moveEvents = events.filter((e) => e.type === 'mousemove');
    expect(moveEvents.length).toBeGreaterThanOrEqual(1);
    expect(moveEvents[0].x).toBe(150);
    expect(moveEvents[0].y).toBe(250);
  });

  it('should throttle high-frequency mousemove', async () => {
    const throttledRecorder = new EventRecorder(
      (event) => { events.push(event); },
      idManager,
      sanitizer,
      { mouseMoveThrottle: 100 },
    );
    throttledRecorder.start(document);

    // Dispatch many mouse moves in rapid succession
    for (let i = 0; i < 10; i++) {
      const moveEvent = new MouseEvent('mousemove', {
        clientX: i * 10,
        clientY: i * 10,
        bubbles: true,
      });
      document.dispatchEvent(moveEvent);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    const moveEvents = events.filter((e) => e.type === 'mousemove');
    // Should be significantly less than 10 due to throttling
    expect(moveEvents.length).toBeLessThan(10);

    throttledRecorder.stop();
  });

  it('should record scroll events', async () => {
    recorder.start(document);

    const scrollEvent = new Event('scroll', { bubbles: true });
    document.dispatchEvent(scrollEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const scrollEvents = events.filter((e) => e.type === 'scroll');
    expect(scrollEvents.length).toBeGreaterThanOrEqual(1);
    expect(scrollEvents[0].scrollTop).toBeDefined();
    expect(scrollEvents[0].scrollLeft).toBeDefined();
  });

  it('should record input events with masked value', () => {
    recorder.start(document);

    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);
    idManager.getId(input);

    input.value = 'secret';
    const inputEvent = new Event('input', { bubbles: true });
    input.dispatchEvent(inputEvent);

    const inputEvents = events.filter((e) => e.type === 'input');
    expect(inputEvents.length).toBe(1);
    expect(inputEvents[0].value).toBe('******'); // Masked
  });

  it('should record input events without masking when disabled', () => {
    const noMaskSanitizer = new Sanitizer({ maskAllInputs: false });
    const noMaskRecorder = new EventRecorder(
      (event) => { events.push(event); },
      idManager,
      noMaskSanitizer,
    );
    noMaskRecorder.start(document);

    const input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);
    idManager.getId(input);

    input.value = 'hello';
    const inputEvent = new Event('input', { bubbles: true });
    input.dispatchEvent(inputEvent);

    const inputEvents = events.filter((e) => e.type === 'input');
    expect(inputEvents.length).toBe(1);
    expect(inputEvents[0].value).toBe('hello');

    noMaskRecorder.stop();
  });

  it('should record focus events', () => {
    recorder.start(document);

    const input = document.createElement('input');
    container.appendChild(input);
    idManager.getId(input);

    const focusEvent = new FocusEvent('focus', { bubbles: true });
    input.dispatchEvent(focusEvent);

    const focusEvents = events.filter((e) => e.type === 'focus');
    expect(focusEvents.length).toBe(1);
    expect(focusEvents[0].targetId).toBeDefined();
  });

  it('should record blur events', () => {
    recorder.start(document);

    const input = document.createElement('input');
    container.appendChild(input);
    idManager.getId(input);

    const blurEvent = new FocusEvent('blur', { bubbles: true });
    input.dispatchEvent(blurEvent);

    const blurEvents = events.filter((e) => e.type === 'blur');
    expect(blurEvents.length).toBe(1);
  });

  it('should record resize events', () => {
    recorder.start(document);

    const resizeEvent = new Event('resize');
    window.dispatchEvent(resizeEvent);

    const resizeEvents = events.filter((e) => e.type === 'resize');
    expect(resizeEvents.length).toBe(1);
    expect(resizeEvents[0].x).toBeDefined();
    expect(resizeEvents[0].y).toBeDefined();
  });

  it('should record select element input', () => {
    recorder.start(document);

    const select = document.createElement('select');
    const option1 = document.createElement('option');
    option1.value = 'opt1';
    const option2 = document.createElement('option');
    option2.value = 'opt2';
    select.appendChild(option1);
    select.appendChild(option2);
    container.appendChild(select);
    idManager.getId(select);

    select.value = 'opt2';
    const inputEvent = new Event('input', { bubbles: true });
    select.dispatchEvent(inputEvent);

    const inputEvents = events.filter((e) => e.type === 'input');
    expect(inputEvents.length).toBe(1);
    // Value is masked because maskAllInputs is true
    expect(inputEvents[0].value).toBe('****');
  });

  it('should not record mouse move when disabled', () => {
    const noMoveRecorder = new EventRecorder(
      (event) => { events.push(event); },
      idManager,
      sanitizer,
      { recordMouseMove: false },
    );
    noMoveRecorder.start(document);

    const moveEvent = new MouseEvent('mousemove', {
      clientX: 100,
      clientY: 100,
      bubbles: true,
    });
    document.dispatchEvent(moveEvent);

    const moveEvents = events.filter((e) => e.type === 'mousemove');
    expect(moveEvents.length).toBe(0);

    noMoveRecorder.stop();
  });

  it('should remove all listeners on stop', () => {
    recorder.start(document);
    recorder.stop();

    // Events after stop should not be recorded
    const clickEvent = new MouseEvent('click', { bubbles: true });
    container.dispatchEvent(clickEvent);

    expect(events.length).toBe(0);
  });

  it('should record textarea input', () => {
    recorder.start(document);

    const textarea = document.createElement('textarea');
    container.appendChild(textarea);
    idManager.getId(textarea);

    textarea.value = 'some text';
    const inputEvent = new Event('input', { bubbles: true });
    textarea.dispatchEvent(inputEvent);

    const inputEvents = events.filter((e) => e.type === 'input');
    expect(inputEvents.length).toBe(1);
    // Masked
    expect(inputEvents[0].value).toBe('*********');
  });

  it('should handle non-element targets gracefully', () => {
    recorder.start(document);

    // Dispatch event from non-element (e.g., document)
    const scrollEvent = new Event('scroll', { bubbles: true });
    document.dispatchEvent(scrollEvent);

    // Should not throw
    expect(events.length).toBeGreaterThanOrEqual(0);
  });
});
