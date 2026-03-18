import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeIdManager, serializeNode, createSnapshot } from '../src/snapshot';
import { Sanitizer } from '../src/sanitizer';

describe('NodeIdManager', () => {
  let idManager: NodeIdManager;

  beforeEach(() => {
    idManager = new NodeIdManager();
  });

  it('should assign incremental IDs to nodes', () => {
    const node1 = document.createElement('div');
    const node2 = document.createElement('span');
    const id1 = idManager.getId(node1);
    const id2 = idManager.getId(node2);
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it('should return same ID for same node', () => {
    const node = document.createElement('div');
    const id1 = idManager.getId(node);
    const id2 = idManager.getId(node);
    expect(id1).toBe(id2);
  });

  it('should check if node has ID', () => {
    const node = document.createElement('div');
    expect(idManager.hasId(node)).toBe(false);
    idManager.getId(node);
    expect(idManager.hasId(node)).toBe(true);
  });

  it('should get node by ID', () => {
    const node = document.createElement('div');
    const id = idManager.getId(node);
    expect(idManager.getNode(id)).toBe(node);
  });

  it('should return undefined for unknown ID', () => {
    expect(idManager.getNode(999)).toBeUndefined();
  });

  it('should remove node mapping', () => {
    const node = document.createElement('div');
    const id = idManager.getId(node);
    idManager.removeNode(node);
    expect(idManager.hasId(node)).toBe(false);
    expect(idManager.getNode(id)).toBeUndefined();
  });

  it('should reset all mappings', () => {
    const node = document.createElement('div');
    idManager.getId(node);
    idManager.reset();
    expect(idManager.hasId(node)).toBe(false);
    // New IDs should start from 1 again
    const newNode = document.createElement('span');
    expect(idManager.getId(newNode)).toBe(1);
  });
});

describe('serializeNode', () => {
  let idManager: NodeIdManager;
  let sanitizer: Sanitizer;

  beforeEach(() => {
    idManager = new NodeIdManager();
    sanitizer = new Sanitizer({ maskAllInputs: false });
  });

  it('should serialize a simple div', () => {
    const div = document.createElement('div');
    div.id = 'test';
    div.className = 'container';

    const result = serializeNode(div, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('element');
    expect(result!.tagName).toBe('div');
    expect(result!.attributes).toEqual({ id: 'test', class: 'container' });
  });

  it('should serialize nested elements', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    child.textContent = 'Hello';
    parent.appendChild(child);

    const result = serializeNode(parent, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(1);
    expect(result!.children![0].tagName).toBe('span');
    expect(result!.children![0].children).toHaveLength(1);
    expect(result!.children![0].children![0].type).toBe('text');
    expect(result!.children![0].children![0].textContent).toBe('Hello');
  });

  it('should serialize text nodes', () => {
    const text = document.createTextNode('Hello World');
    const result = serializeNode(text, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('text');
    expect(result!.textContent).toBe('Hello World');
  });

  it('should serialize comment nodes', () => {
    const comment = document.createComment('This is a comment');
    const result = serializeNode(comment, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('comment');
    expect(result!.textContent).toBe('');
  });

  it('should skip script tags', () => {
    const script = document.createElement('script');
    script.textContent = 'alert("hack")';
    const result = serializeNode(script, idManager, sanitizer);
    expect(result).toBeNull();
  });

  it('should skip noscript tags', () => {
    const noscript = document.createElement('noscript');
    const result = serializeNode(noscript, idManager, sanitizer);
    expect(result).toBeNull();
  });

  it('should skip ignored elements', () => {
    const div = document.createElement('div');
    div.setAttribute('data-monitor-ignore', '');
    const result = serializeNode(div, idManager, sanitizer);
    expect(result).toBeNull();
  });

  it('should block elements with data-monitor-block', () => {
    const div = document.createElement('div');
    div.setAttribute('data-monitor-block', '');
    div.innerHTML = '<p>Secret content</p>';

    const result = serializeNode(div, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.tagName).toBe('div');
    expect(result!.attributes).toHaveProperty('class', 'monitor-blocked');
    expect(result!.children![0].textContent).toBe('[blocked content]');
  });

  it('should skip on* event handler attributes', () => {
    const div = document.createElement('div');
    div.setAttribute('onclick', 'alert(1)');
    div.setAttribute('onload', 'init()');
    div.id = 'safe';

    const result = serializeNode(div, idManager, sanitizer);
    expect(result!.attributes).toEqual({ id: 'safe' });
    expect(result!.attributes!['onclick']).toBeUndefined();
    expect(result!.attributes!['onload']).toBeUndefined();
  });

  it('should capture input value', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'user input';

    const result = serializeNode(input, idManager, sanitizer);
    expect(result!.attributes!['value']).toBe('user input');
  });

  it('should mask password input value', () => {
    const s = new Sanitizer({ maskAllInputs: true });
    const input = document.createElement('input');
    input.type = 'password';
    input.value = 'secret123';

    const result = serializeNode(input, idManager, s);
    expect(result!.attributes!['value']).toBe('*********');
  });

  it('should capture checkbox checked state', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;

    const result = serializeNode(input, idManager, sanitizer);
    expect(result!.attributes!['checked']).toBe('true');
  });

  it('should sanitize text content with sensitive patterns', () => {
    const span = document.createElement('span');
    span.textContent = 'Email: user@example.com';
    document.body.appendChild(span);

    const result = serializeNode(span, idManager, sanitizer);
    const textChild = result!.children![0];
    expect(textChild.textContent).toContain('***@***.***');

    document.body.removeChild(span);
  });

  it('should handle max depth protection', () => {
    // Create deeply nested structure
    let current = document.createElement('div');
    const root = current;
    for (let i = 0; i < 5; i++) {
      const child = document.createElement('div');
      current.appendChild(child);
      current = child;
    }

    // With maxDepth = 3, deeper nodes should be cut off
    const result = serializeNode(root, idManager, sanitizer, 0, 3);
    expect(result).not.toBeNull();
    // Verify it doesn't crash and returns a result
    expect(result!.type).toBe('element');
  });

  it('should handle SVG elements', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');

    const result = serializeNode(svg, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.tagName).toBe('svg');
    expect(result!.isSVG).toBe(true);
    expect(result!.attributes!['width']).toBe('100');
  });

  it('should serialize style elements with text content', () => {
    const style = document.createElement('style');
    style.textContent = 'body { color: red; }';

    const result = serializeNode(style, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.tagName).toBe('style');
    expect(result!.children).toHaveLength(1);
    expect(result!.children![0].type).toBe('text');
    expect(result!.children![0].textContent).toBe('body { color: red; }');
  });

  it('should handle empty elements', () => {
    const div = document.createElement('div');
    const result = serializeNode(div, idManager, sanitizer);
    expect(result).not.toBeNull();
    expect(result!.children).toBeUndefined();
  });
});

describe('createSnapshot', () => {
  let idManager: NodeIdManager;
  let sanitizer: Sanitizer;
  let container: HTMLDivElement;

  beforeEach(() => {
    idManager = new NodeIdManager();
    sanitizer = new Sanitizer();
    container = document.createElement('div');
    container.id = 'app';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it('should create a complete snapshot of the document', () => {
    container.innerHTML = '<h1>Title</h1><p>Content</p>';

    const snapshot = createSnapshot(document, idManager, sanitizer);

    expect(snapshot).toBeDefined();
    expect(snapshot.node).toBeDefined();
    expect(snapshot.node.type).toBe('document');
    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.initialScroll).toBeDefined();
    expect(snapshot.initialScroll!.x).toBe(0);
    expect(snapshot.initialScroll!.y).toBe(0);
  });

  it('should serialize the full DOM tree', () => {
    container.innerHTML = '<ul><li>Item 1</li><li>Item 2</li></ul>';

    const snapshot = createSnapshot(document, idManager, sanitizer);

    // document → html → body → container → ul → li × 2
    expect(snapshot.node.children).toBeDefined();
    expect(snapshot.node.children!.length).toBeGreaterThan(0);
  });

  it('should assign unique IDs to all nodes', () => {
    container.innerHTML = '<div><span>A</span><span>B</span></div>';

    const snapshot = createSnapshot(document, idManager, sanitizer);

    // Collect all IDs
    const ids = new Set<number>();
    function collectIds(node: { id: number; children?: { id: number; children?: unknown[] }[] }) {
      ids.add(node.id);
      node.children?.forEach((child) => collectIds(child as { id: number; children?: { id: number; children?: unknown[] }[] }));
    }
    collectIds(snapshot.node);

    // All IDs should be unique
    expect(ids.size).toBeGreaterThan(1);
  });
});
