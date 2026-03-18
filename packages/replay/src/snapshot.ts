import type { SerializedNode, SerializedNodeType, DOMSnapshot } from '@monitor/types';
import { now } from '@monitor/utils';
import { Sanitizer } from './sanitizer';

/**
 * 节点 ID 管理器
 * 为每个 DOM 节点分配唯一的数字 ID，用于增量 mutation 追踪
 */
export class NodeIdManager {
  private nextId: number = 1;
  private nodeToId: WeakMap<Node, number> = new WeakMap();
  private idToNode: Map<number, WeakRef<Node>> = new Map();

  /**
   * 获取节点的 ID，如果没有则分配新 ID
   */
  getId(node: Node): number {
    let id = this.nodeToId.get(node);
    if (id === undefined) {
      id = this.nextId++;
      this.nodeToId.set(node, id);
      this.idToNode.set(id, new WeakRef(node));
    }
    return id;
  }

  /**
   * 检查节点是否已有 ID
   */
  hasId(node: Node): boolean {
    return this.nodeToId.has(node);
  }

  /**
   * 根据 ID 获取节点（可能已被 GC 回收）
   */
  getNode(id: number): Node | undefined {
    const ref = this.idToNode.get(id);
    return ref?.deref();
  }

  /**
   * 移除节点的 ID 映射
   */
  removeNode(node: Node): void {
    const id = this.nodeToId.get(node);
    if (id !== undefined) {
      this.nodeToId.delete(node);
      this.idToNode.delete(id);
    }
  }

  /**
   * 重置所有 ID 分配
   */
  reset(): void {
    this.nextId = 1;
    this.nodeToId = new WeakMap();
    this.idToNode = new Map();
  }
}

/**
 * SVG 命名空间
 */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * 不应序列化内容的标签
 */
const SKIP_CONTENT_TAGS = new Set([
  'script',
  'noscript',
  'style',
]);

/**
 * 完全不录制的标签
 */
const SKIP_TAGS = new Set([
  'script',
  'noscript',
]);

/**
 * 判断节点是否为 SVG 元素
 */
function isSVGElement(element: Element): boolean {
  return element.namespaceURI === SVG_NAMESPACE;
}

/**
 * 获取元素的属性字典
 */
function getAttributes(element: Element, sanitizer: Sanitizer): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    // 跳过事件处理器属性（on* 属性）
    if (attr.name.startsWith('on')) continue;
    attrs[attr.name] = sanitizer.sanitizeAttribute(element, attr.name, attr.value);
  }

  // 对于 input/textarea/select，补充运行时 value
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') {
    const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
    const runtimeValue = inputEl.value;
    if (runtimeValue !== undefined && runtimeValue !== '') {
      if (sanitizer.shouldMaskInput(element)) {
        attrs['value'] = sanitizer.maskInputValue(runtimeValue);
      } else {
        attrs['value'] = sanitizer.sanitizeText(runtimeValue);
      }
    }
    // checkbox / radio checked 状态
    if (tagName === 'input') {
      const inputElement = element as HTMLInputElement;
      if (inputElement.type === 'checkbox' || inputElement.type === 'radio') {
        attrs['checked'] = String(inputElement.checked);
      }
    }
  }

  if (tagName === 'select') {
    const selectEl = element as HTMLSelectElement;
    if (sanitizer.shouldMaskInput(element)) {
      attrs['value'] = sanitizer.maskInputValue(selectEl.value);
    } else {
      attrs['value'] = sanitizer.sanitizeText(selectEl.value);
    }
  }

  // 对于 media 元素，记录状态
  if (tagName === 'video' || tagName === 'audio') {
    const mediaEl = element as HTMLMediaElement;
    attrs['rr_mediaState'] = mediaEl.paused ? 'paused' : 'playing';
    if (mediaEl.currentTime) {
      attrs['rr_mediaCurrentTime'] = String(mediaEl.currentTime);
    }
  }

  return attrs;
}

/**
 * serializeNode — 递归将 DOM 节点序列化为 SerializedNode
 *
 * @param node - 要序列化的 DOM 节点
 * @param idManager - 节点 ID 管理器
 * @param sanitizer - 脱敏引擎
 * @param depth - 当前深度（防止过深递归）
 * @param maxDepth - 最大递归深度
 * @returns 序列化后的节点，或 null（被忽略的节点）
 */
export function serializeNode(
  node: Node,
  idManager: NodeIdManager,
  sanitizer: Sanitizer,
  depth: number = 0,
  maxDepth: number = 100,
): SerializedNode | null {
  // 深度保护
  if (depth > maxDepth) {
    return null;
  }

  const id = idManager.getId(node);

  switch (node.nodeType) {
    case Node.DOCUMENT_NODE: {
      const doc = node as Document;
      const children: SerializedNode[] = [];
      for (let i = 0; i < doc.childNodes.length; i++) {
        const child = serializeNode(doc.childNodes[i], idManager, sanitizer, depth + 1, maxDepth);
        if (child) children.push(child);
      }
      return {
        id,
        type: 'document' as SerializedNodeType,
        children,
      };
    }

    case Node.DOCUMENT_TYPE_NODE: {
      const doctype = node as DocumentType;
      return {
        id,
        type: 'doctype' as SerializedNodeType,
        textContent: doctype.name || 'html',
      };
    }

    case Node.ELEMENT_NODE: {
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      // 完全跳过 script/noscript
      if (SKIP_TAGS.has(tagName)) {
        return null;
      }

      // 检查是否应被忽略
      if (sanitizer.shouldIgnore(element)) {
        return null;
      }

      // 检查是否应被 block（替换为占位块）
      if (sanitizer.shouldBlock(element)) {
        return {
          id,
          type: 'element' as SerializedNodeType,
          tagName: 'div',
          attributes: {
            'class': 'monitor-blocked',
            'data-original-tag': tagName,
          },
          children: [{
            id: idManager.getId(document.createTextNode('[blocked content]')),
            type: 'text' as SerializedNodeType,
            textContent: '[blocked content]',
          }],
        };
      }

      const attributes = getAttributes(element, sanitizer);
      const isSVG = isSVGElement(element);
      const children: SerializedNode[] = [];

      // 不序列化 style 标签的子内容（只保留 textContent）
      if (tagName === 'style') {
        const styleText = element.textContent || '';
        if (styleText) {
          children.push({
            id: idManager.getId(element.firstChild || document.createTextNode(styleText)),
            type: 'text' as SerializedNodeType,
            textContent: styleText,
          });
        }
      } else if (!SKIP_CONTENT_TAGS.has(tagName)) {
        // 递归序列化子节点
        for (let i = 0; i < element.childNodes.length; i++) {
          const child = serializeNode(
            element.childNodes[i],
            idManager,
            sanitizer,
            depth + 1,
            maxDepth,
          );
          if (child) children.push(child);
        }
      }

      const result: SerializedNode = {
        id,
        type: 'element' as SerializedNodeType,
        tagName,
        attributes,
      };

      if (children.length > 0) {
        result.children = children;
      }
      if (isSVG) {
        result.isSVG = true;
      }

      return result;
    }

    case Node.TEXT_NODE: {
      const text = node.textContent || '';
      // 跳过纯空白文本节点
      if (!text.trim()) {
        // 保留有意义的空白（如 <span> </span> 中的空格）
        if (text.length === 0) return null;
      }
      const parentElement = node.parentElement;
      const sanitizedText = sanitizer.sanitizeNodeText(text, parentElement);
      return {
        id,
        type: 'text' as SerializedNodeType,
        textContent: sanitizedText,
      };
    }

    case Node.COMMENT_NODE: {
      // 通常不需要录制注释，但保留结构完整性
      return {
        id,
        type: 'comment' as SerializedNodeType,
        textContent: '',
      };
    }

    case Node.CDATA_SECTION_NODE: {
      return {
        id,
        type: 'cdata' as SerializedNodeType,
        textContent: node.textContent || '',
      };
    }

    default:
      return null;
  }
}

/**
 * createSnapshot — 创建当前页面的完整 DOM 快照
 *
 * @param doc - Document 对象
 * @param idManager - 节点 ID 管理器
 * @param sanitizer - 脱敏引擎
 * @returns 完整的 DOM 快照
 */
export function createSnapshot(
  doc: Document,
  idManager: NodeIdManager,
  sanitizer: Sanitizer,
): DOMSnapshot {
  const rootNode = serializeNode(doc, idManager, sanitizer);

  if (!rootNode) {
    throw new Error('Failed to serialize document');
  }

  return {
    node: rootNode,
    timestamp: now(),
    initialScroll: {
      x: doc.defaultView?.scrollX || 0,
      y: doc.defaultView?.scrollY || 0,
    },
  };
}
