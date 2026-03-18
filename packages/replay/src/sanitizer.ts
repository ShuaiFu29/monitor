import type { SanitizeConfig } from '@monitor/types';

/**
 * 默认脱敏配置
 */
const DEFAULT_CONFIG: SanitizeConfig = {
  maskAllInputs: true,
  maskAllText: false,
  blockSelectors: [],
  ignoreSelectors: [],
  customPatterns: [],
};

/**
 * 敏感 input 类型 — 始终脱敏
 */
const SENSITIVE_INPUT_TYPES = new Set([
  'password',
  'hidden',
  'credit-card',
]);

/**
 * 内置正则脱敏规则
 */
const BUILTIN_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // 信用卡号：4组4位数字
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '****-****-****-****' },
  // 中国身份证号：18位
  { pattern: /\b\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, replacement: '******' },
  // 邮箱地址
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '***@***.***' },
  // 手机号码（中国）
  { pattern: /\b1[3-9]\d{9}\b/g, replacement: '***********' },
];

/**
 * 自定义脱敏属性名
 */
const MASK_ATTRIBUTE = 'data-monitor-mask';
const BLOCK_ATTRIBUTE = 'data-monitor-block';
const IGNORE_ATTRIBUTE = 'data-monitor-ignore';

/**
 * Sanitizer — 隐私脱敏引擎
 *
 * 负责对 DOM 快照和增量数据中的敏感信息进行脱敏处理：
 * - 密码输入框 → 值替换为 mask 字符
 * - 标记为 data-monitor-mask 的元素 → 文本内容被 mask
 * - 标记为 data-monitor-block 的元素 → 整个内容替换为占位
 * - 内置正则：信用卡号、身份证号、邮箱、手机号
 * - 自定义正则规则
 */
export class Sanitizer {
  private config: SanitizeConfig;
  private allPatterns: Array<{ pattern: RegExp; replacement: string }>;

  constructor(config: Partial<SanitizeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // 合并内置 + 自定义正则规则
    this.allPatterns = [
      ...BUILTIN_PATTERNS,
      ...(this.config.customPatterns || []),
    ];
  }

  /**
   * 判断元素是否应被 block（整体替换为占位块）
   */
  shouldBlock(element: Element): boolean {
    if (element.hasAttribute(BLOCK_ATTRIBUTE)) {
      return true;
    }
    if (this.config.blockSelectors.length > 0) {
      return this.config.blockSelectors.some((selector) => {
        try {
          return element.matches(selector);
        } catch {
          return false;
        }
      });
    }
    return false;
  }

  /**
   * 判断元素是否应被忽略（完全不录制）
   */
  shouldIgnore(element: Element): boolean {
    if (element.hasAttribute(IGNORE_ATTRIBUTE)) {
      return true;
    }
    if (this.config.ignoreSelectors.length > 0) {
      return this.config.ignoreSelectors.some((selector) => {
        try {
          return element.matches(selector);
        } catch {
          return false;
        }
      });
    }
    return false;
  }

  /**
   * 判断元素是否需要对文本内容进行 mask
   */
  shouldMaskText(element: Element): boolean {
    if (element.hasAttribute(MASK_ATTRIBUTE)) {
      return true;
    }
    if (this.config.maskAllText) {
      return true;
    }
    return false;
  }

  /**
   * 判断 input 元素是否需要对值进行 mask
   */
  shouldMaskInput(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'input') {
      const inputType = (element.getAttribute('type') || 'text').toLowerCase();
      // 敏感类型始终 mask
      if (SENSITIVE_INPUT_TYPES.has(inputType)) {
        return true;
      }
      // maskAllInputs 配置
      if (this.config.maskAllInputs) {
        return true;
      }
    }

    if (tagName === 'textarea') {
      if (this.config.maskAllInputs) {
        return true;
      }
    }

    if (tagName === 'select') {
      if (this.config.maskAllInputs) {
        return true;
      }
    }

    // 检查 data-monitor-mask 属性
    if (element.hasAttribute(MASK_ATTRIBUTE)) {
      return true;
    }

    return false;
  }

  /**
   * 对文本进行 mask 处理
   * 将每个字符替换为 *, 保留空白字符
   */
  maskText(text: string): string {
    return text.replace(/\S/g, '*');
  }

  /**
   * 对 input 值进行 mask
   */
  maskInputValue(value: string): string {
    if (!value) return value;
    return '*'.repeat(value.length);
  }

  /**
   * 对文本应用正则脱敏规则（信用卡、身份证、邮箱、手机号等）
   */
  sanitizeText(text: string): string {
    if (!text) return text;

    let result = text;
    for (const { pattern, replacement } of this.allPatterns) {
      // 重置 lastIndex（对全局正则）
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  /**
   * 对属性值进行脱敏
   * - 部分属性（如 value, placeholder）可能包含敏感信息
   * - href/src/action 中的 URL 也可能泄露信息
   */
  sanitizeAttribute(element: Element, name: string, value: string): string {
    // input/textarea 的 value 属性
    if (name === 'value' && this.shouldMaskInput(element)) {
      return this.maskInputValue(value);
    }

    // 对所有属性值应用正则脱敏
    return this.sanitizeText(value);
  }

  /**
   * 对节点文本内容进行综合脱敏
   * 根据父元素的配置决定处理方式
   */
  sanitizeNodeText(text: string, parentElement?: Element | null): string {
    if (!text) return text;

    // 如果父元素标记为需要 mask 文本
    if (parentElement && this.shouldMaskText(parentElement)) {
      return this.maskText(text);
    }

    // 否则只做正则脱敏
    return this.sanitizeText(text);
  }

  /**
   * 获取脱敏配置
   */
  getConfig(): SanitizeConfig {
    return { ...this.config };
  }
}
