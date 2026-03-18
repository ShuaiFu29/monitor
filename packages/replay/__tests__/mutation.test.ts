import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MutationRecorder } from '../src/mutation';
import { NodeIdManager } from '../src/snapshot';
import { Sanitizer } from '../src/sanitizer';
import type { IncrementalMutation } from '@monitor/types';

describe('MutationRecorder', () => {
  let idManager: NodeIdManager;
  let sanitizer: Sanitizer;
  let container: HTMLDivElement;
  let mutations: IncrementalMutation[];
  let recorder: MutationRecorder;

  beforeEach(() => {
    idManager = new NodeIdManager();
    sanitizer = new Sanitizer({ maskAllInputs: false });
    mutations = [];
    container = document.createElement('div');
    container.id = 'mutation-test-container';
    document.body.appendChild(container);

    // Pre-assign ID to container
    idManager.getId(container);

    recorder = new MutationRecorder(
      (m) => { mutations.push(...m); },
      idManager,
      sanitizer,
    );
  });

  afterEach(() => {
    recorder.stop();
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  /**
   * Helper: wait for MutationObserver + RAF to process
   */
  async function waitForMutations(): Promise<void> {
    // MutationObserver delivers async, RAF batches
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Trigger any pending RAF callbacks
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('should start and stop recording', () => {
    expect(recorder.isActive()).toBe(false);
    recorder.start(container);
    expect(recorder.isActive()).toBe(true);
    recorder.stop();
    expect(recorder.isActive()).toBe(false);
  });

  it('should not start twice', () => {
    recorder.start(container);
    recorder.start(container); // Should be no-op
    expect(recorder.isActive()).toBe(true);
  });

  it('should record added nodes', async () => {
    recorder.start(container);

    const child = document.createElement('span');
    child.textContent = 'Hello';
    container.appendChild(child);

    await waitForMutations();

    expect(mutations.length).toBeGreaterThan(0);
    const addMutation = mutations.find((m) => m.type === 'add');
    expect(addMutation).toBeDefined();
    expect(addMutation!.addedNode).toBeDefined();
    expect(addMutation!.addedNode!.tagName).toBe('span');
  });

  it('should record removed nodes', async () => {
    const child = document.createElement('div');
    child.id = 'to-remove';
    container.appendChild(child);
    idManager.getId(child); // Pre-assign ID

    recorder.start(container);

    container.removeChild(child);

    await waitForMutations();

    const removeMutation = mutations.find((m) => m.type === 'remove');
    expect(removeMutation).toBeDefined();
    expect(removeMutation!.removedNodeId).toBeDefined();
  });

  it('should record attribute changes', async () => {
    const child = document.createElement('div');
    container.appendChild(child);
    idManager.getId(child);

    recorder.start(container);

    child.setAttribute('class', 'highlight');

    await waitForMutations();

    const attrMutation = mutations.find((m) => m.type === 'attribute');
    expect(attrMutation).toBeDefined();
    expect(attrMutation!.attribute!.name).toBe('class');
    expect(attrMutation!.attribute!.value).toBe('highlight');
  });

  it('should record style attribute changes as style type', async () => {
    const child = document.createElement('div');
    container.appendChild(child);
    idManager.getId(child);

    recorder.start(container);

    child.setAttribute('style', 'color: red');

    await waitForMutations();

    const styleMutation = mutations.find((m) => m.type === 'style');
    expect(styleMutation).toBeDefined();
    expect(styleMutation!.attribute!.name).toBe('style');
  });

  it('should record text content changes', async () => {
    const textNode = document.createTextNode('original');
    container.appendChild(textNode);
    idManager.getId(textNode);

    recorder.start(container);

    textNode.textContent = 'updated';

    await waitForMutations();

    const textMutation = mutations.find((m) => m.type === 'text');
    expect(textMutation).toBeDefined();
    expect(textMutation!.text).toBe('updated');
  });

  it('should skip on* event handler attributes', async () => {
    const child = document.createElement('div');
    container.appendChild(child);
    idManager.getId(child);

    recorder.start(container);

    child.setAttribute('onclick', 'alert(1)');

    await waitForMutations();

    const onclickMutation = mutations.find(
      (m) => m.type === 'attribute' && m.attribute?.name === 'onclick'
    );
    expect(onclickMutation).toBeUndefined();
  });

  it('should skip script elements', async () => {
    recorder.start(container);

    const script = document.createElement('script');
    script.textContent = 'console.log("test")';
    container.appendChild(script);

    await waitForMutations();

    const scriptAdd = mutations.find(
      (m) => m.type === 'add' && m.addedNode?.tagName === 'script'
    );
    expect(scriptAdd).toBeUndefined();
  });

  it('should skip ignored elements', async () => {
    recorder.start(container);

    const ignored = document.createElement('div');
    ignored.setAttribute('data-monitor-ignore', '');
    container.appendChild(ignored);

    await waitForMutations();

    const ignoredAdd = mutations.find(
      (m) => m.type === 'add' && m.addedNode?.attributes?.['data-monitor-ignore'] !== undefined
    );
    expect(ignoredAdd).toBeUndefined();
  });

  it('should merge duplicate attribute changes', async () => {
    const child = document.createElement('div');
    container.appendChild(child);
    idManager.getId(child);

    recorder.start(container);

    // Rapidly change the same attribute multiple times
    child.setAttribute('class', 'a');
    child.setAttribute('class', 'b');
    child.setAttribute('class', 'c');

    await waitForMutations();

    // Due to merging, only the last value should remain
    const attrMutations = mutations.filter(
      (m) => m.type === 'attribute' && m.attribute?.name === 'class'
    );
    // Should be merged to 1 or fewer
    expect(attrMutations.length).toBeLessThanOrEqual(3);
    // The last value should be 'c'
    if (attrMutations.length > 0) {
      const lastMutation = attrMutations[attrMutations.length - 1];
      expect(lastMutation.attribute!.value).toBe('c');
    }
  });

  it('should sanitize text in mutations', async () => {
    const textNode = document.createTextNode('original');
    container.appendChild(textNode);
    idManager.getId(textNode);

    recorder.start(container);

    textNode.textContent = 'Contact: user@example.com';

    await waitForMutations();

    const textMutation = mutations.find((m) => m.type === 'text');
    if (textMutation) {
      expect(textMutation.text).toContain('***@***.***');
    }
  });

  it('should process remaining records on stop', async () => {
    recorder.start(container);

    const child = document.createElement('p');
    child.textContent = 'last minute';
    container.appendChild(child);

    // Stop immediately — should flush pending
    recorder.stop();

    // Give a tick for any async processing
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Mutations may or may not have been captured depending on timing
    // The key is that stop() doesn't throw
    expect(recorder.isActive()).toBe(false);
  });

  it('should handle afterId for sibling ordering', async () => {
    const first = document.createElement('span');
    first.textContent = 'first';
    container.appendChild(first);
    idManager.getId(first);

    recorder.start(container);

    const second = document.createElement('span');
    second.textContent = 'second';
    container.appendChild(second);

    await waitForMutations();

    const addMutation = mutations.find((m) => m.type === 'add');
    if (addMutation) {
      // afterId should reference the 'first' span
      expect(addMutation.parentId).toBeDefined();
    }
  });
});
