# Monitor SDK

<p align="center">
  <strong>企业级前端监控 SDK</strong><br>
  微内核 + 插件架构 · TypeScript · 全链路可观测
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.4-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tests-790%20passed-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/Coverage-95.68%25-brightgreen" alt="Coverage" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</p>

---

## 目录

- [特性](#特性)
- [架构](#架构)
- [快速开始](#快速开始)
- [包概览](#包概览)
- [配置参考](#配置参考)
- [插件详解](#插件详解)
  - [错误监控](#错误监控-monitorerror)
  - [性能监控](#性能监控-monitorperformance)
  - [网络监控](#网络监控-monitornetwork)
  - [数据传输](#数据传输-monitortransport)
  - [会话回放](#会话回放-monitorreplay)
  - [用户行为](#用户行为-monitorbehavior)
  - [Web Worker 线程池](#web-worker-线程池-monitorworker)
- [高级用法](#高级用法)
- [示例项目](#示例项目)
- [开发指南](#开发指南)
- [技术栈](#技术栈)
- [License](#license)

---

## 特性

- **微内核 + 插件架构** — 核心 < 5KB (gzip)，按需加载插件，支持自定义扩展
- **全链路错误监控** — JS 运行时错误、Promise 拒绝、资源加载失败，Chrome/Firefox/Safari 堆栈解析，SourceMap 还原
- **Web Vitals 性能指标** — LCP、FID、INP、CLS、TTFB、FCP 六大核心指标 + 长任务检测 + 资源加载计时
- **网络请求拦截** — Fetch/XHR 无侵入 monkey-patch，W3C Trace Context 分布式链路追踪
- **可靠数据传输** — Beacon/Fetch/XHR/Image 四级降级发送，指数退避重试，gzip 压缩，IndexedDB 离线存储，网络恢复自动重传
- **Session Replay** — DOM 快照 + MutationObserver 增量录制，用户交互记录，隐私脱敏，播放引擎（倍速 / 跳转）
- **用户行为分析** — 点击追踪、热力图采集、用户路径追踪（History API 无侵入拦截）、自定义事件
- **动态采样** — 错误事件始终 100% 采集，自动降级/恢复非关键事件采样率
- **Web Worker 卸载** — 压缩和 SourceMap 解析异步卸载到 Worker 线程，主线程零阻塞
- **TypeScript First** — 100% TypeScript 编写，完整类型导出
- **零依赖核心** — 仅 `fflate` 用于 gzip 压缩，无其他运行时依赖
- **Tree-Shakeable** — ESM + CJS 双格式输出，未使用的模块被完全摇树移除

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    @monitor/browser                      │
│                    createMonitor()                        │
├─────────────────────────────────────────────────────────┤
│                      @monitor/core                       │
│  ┌──────────┐ ┌───────────────┐ ┌──────────────────┐    │
│  │ EventBus │ │ PluginManager │ │  ConfigManager   │    │
│  └──────────┘ └───────────────┘ └──────────────────┘    │
│  ┌────────────────┐ ┌────────────┐ ┌───────────────┐    │
│  │ SessionManager │ │ EventQueue │ │DynamicSampler │    │
│  └────────────────┘ └────────────┘ └───────────────┘    │
├────────┬────────┬────────┬──────────┬────────┬──────────┤
│ error  │ perf   │network │transport │ replay │ behavior │
│ Plugin │ Plugin │Plugin  │ Plugin   │ Plugin │ Plugin   │
├────────┴────────┴────────┴──────────┴────────┴──────────┤
│              @monitor/worker (Web Workers)                │
├─────────────────────────────────────────────────────────┤
│        @monitor/utils        @monitor/types              │
└─────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 安装

```bash
# npm
npm install @monitor/browser @monitor/error @monitor/performance @monitor/network @monitor/transport

# pnpm
pnpm add @monitor/browser @monitor/error @monitor/performance @monitor/network @monitor/transport
```

### 基本用法

```typescript
import { createMonitor } from '@monitor/browser';
import { errorPlugin } from '@monitor/error';
import { performancePlugin } from '@monitor/performance';
import { networkPlugin } from '@monitor/network';
import { transportPlugin } from '@monitor/transport';

const monitor = createMonitor({
  dsn: 'https://your-key@your-server.com/1',
  release: '1.0.0',
  environment: 'production',

  plugins: [
    errorPlugin(),
    performancePlugin(),
    networkPlugin({ ignoreUrls: ['/health', '/api/report'] }),
    transportPlugin({ compression: true, offline: true }),
  ],

  // 事件发送前拦截
  beforeSend(event) {
    // 过滤、修改或丢弃事件
    return event; // 返回 null 丢弃
  },
});

// 手动上报自定义事件
monitor.captureEvent({
  type: 'custom',
  action: 'user_signup',
  data: { plan: 'pro' },
});

// 设置用户信息
monitor.setUser({ id: 'u_123', name: 'Alice', email: 'alice@example.com' });

// 销毁 SDK（SPA 路由卸载时调用）
monitor.destroy();
```

### CDN 方式

```html
<script src="https://cdn.example.com/monitor-sdk/1.0.0/monitor.umd.js"></script>
<script>
  const monitor = MonitorSDK.createMonitor({
    dsn: 'https://your-key@your-server.com/1',
    plugins: [
      MonitorSDK.errorPlugin(),
      MonitorSDK.performancePlugin(),
    ],
  });
</script>
```

---

## 包概览

| 包名 | 说明 | 大小 (gzip) |
|------|------|------------|
| `@monitor/types` | TypeScript 类型定义 | — |
| `@monitor/utils` | 工具函数（hash、序列化、环境检测、日志） | ~1 KB |
| `@monitor/core` | 微内核（EventBus、PluginManager、ConfigManager 等） | < 5 KB |
| `@monitor/browser` | 浏览器入口 `createMonitor()` | < 1 KB |
| `@monitor/error` | 错误监控插件 | ~3 KB |
| `@monitor/performance` | 性能监控插件 (Web Vitals) | ~2 KB |
| `@monitor/network` | 网络监控插件 (Fetch/XHR) | ~2 KB |
| `@monitor/transport` | 数据传输插件（四级降级、压缩、离线） | ~5 KB |
| `@monitor/replay` | 会话回放插件 | ~6 KB |
| `@monitor/behavior` | 用户行为插件 | ~3 KB |
| `@monitor/worker` | Web Worker 线程池 | ~2 KB |

---

## 配置参考

```typescript
interface MonitorConfig {
  /** 数据上报地址 (必填) */
  dsn: string;
  /** 应用版本号 */
  release?: string;
  /** 运行环境: 'production' | 'staging' | 'development' */
  environment?: string;

  // ── 采样配置 ──
  /** 全局采样率 0-1，默认 1 */
  sampleRate?: number;
  /** 错误事件采样率 0-1，默认 1 */
  errorSampleRate?: number;
  /** 性能事件采样率 0-1，默认 1 */
  performanceSampleRate?: number;

  // ── 用户信息 ──
  userId?: string;
  userName?: string;
  userEmail?: string;

  // ── 数据上报 ──
  /** 批量上报大小，默认 10 */
  batchSize?: number;
  /** 批量上报间隔 (ms)，默认 5000 */
  flushInterval?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;

  // ── 扩展 ──
  context?: Record<string, unknown>;
  plugins?: Plugin[];

  // ── 钩子 ──
  /** 事件发送前拦截器，返回 null 则丢弃 */
  beforeSend?: (event: BaseEvent) => BaseEvent | null;
  /** SDK 内部错误回调 */
  onError?: (error: Error) => void;
}
```

---

## 插件详解

### 错误监控 (`@monitor/error`)

自动捕获三类错误，无需手动编码：

```typescript
import { errorPlugin } from '@monitor/error';

const plugin = errorPlugin({
  // 面包屑最大数量，默认 20
  maxBreadcrumbs: 30,
  // 聚合窗口时间 (ms)，默认 5000
  aggregateWindow: 10000,
  // 是否捕获资源加载错误，默认 true
  captureResourceErrors: true,
});
```

**捕获范围：**

| 错误类型 | 捕获方式 | 示例 |
|---------|---------|------|
| JS 运行时错误 | `window.onerror` | `TypeError`, `ReferenceError` |
| Promise 拒绝 | `unhandledrejection` | 未 catch 的 async 错误 |
| 资源加载失败 | `addEventListener('error', ..., true)` | `<img>`, `<script>`, `<link>` |

**特性：**
- Chrome / Firefox / Safari 三种堆栈格式自动识别解析
- 基于 `message + filename + lineno + colno` 的指纹生成和去重
- SourceMap V3 解析还原（支持 VLQ 解码、LRU 缓存）
- 环形缓冲面包屑，自动记录导致错误的操作轨迹
- SDK 自保护：内部异常不会崩溃宿主页面

---

### 性能监控 (`@monitor/performance`)

基于 PerformanceObserver API 采集 Web Vitals：

```typescript
import { performancePlugin } from '@monitor/performance';

const plugin = performancePlugin({
  webVitals: true,      // Web Vitals 六项指标
  longTasks: true,       // 长任务检测 (> 50ms)
  resources: true,       // 资源加载计时
  longTaskConfig: {
    threshold: 100,      // 长任务阈值 (ms)
  },
  resourceConfig: {
    ignorePatterns: [/analytics/],
  },
});
```

**采集指标：**

| 指标 | 说明 | 评级标准 |
|------|------|---------|
| LCP | 最大内容绘制 | ≤2500ms good / ≤4000ms needs-improvement |
| FID | 首次输入延迟 | ≤100ms good / ≤300ms needs-improvement |
| INP | 交互到下一帧绘制 | ≤200ms good / ≤500ms needs-improvement |
| CLS | 累积布局偏移 | ≤0.1 good / ≤0.25 needs-improvement |
| TTFB | 首字节时间 | ≤800ms good / ≤1800ms needs-improvement |
| FCP | 首次内容绘制 | ≤1800ms good / ≤3000ms needs-improvement |

---

### 网络监控 (`@monitor/network`)

无侵入拦截 Fetch/XHR 请求，自动注入链路追踪头：

```typescript
import { networkPlugin } from '@monitor/network';

const plugin = networkPlugin({
  fetch: true,           // 拦截 Fetch
  xhr: true,             // 拦截 XMLHttpRequest
  tracing: true,         // W3C Trace Context
  traceConfig: {
    // 只对匹配的域名注入追踪头
    propagateTargets: [/api\.example\.com/],
    sampleRate: 1.0,
  },
  ignoreUrls: [
    '/health',
    '/api/report',       // 忽略上报接口自身
    /\.(png|jpg|css|js)$/,
  ],
});
```

**链路追踪：** 自动注入 W3C 标准 `traceparent` 头，格式为 `00-{traceId}-{spanId}-{flags}`，与 OpenTelemetry 后端无缝对接。

---

### 数据传输 (`@monitor/transport`)

可靠的事件上报引擎，确保数据不丢失：

```typescript
import { transportPlugin } from '@monitor/transport';

const plugin = transportPlugin({
  compression: true,          // gzip 压缩
  compressionThreshold: 1024, // 超过 1KB 才压缩
  offline: true,              // IndexedDB 离线存储
  offlineConfig: {
    maxSize: 500,             // 最多缓存 500 条事件
    ttl: 24 * 60 * 60 * 1000, // 24 小时过期
  },
  retryConfig: {
    maxRetries: 3,
    baseDelay: 1000,          // 指数退避基础延迟
    maxDelay: 30000,
  },
  unloadFlush: true,           // 页面卸载时 flush
});
```

**发送策略（四级降级）：**

```
Navigator.sendBeacon (最优先)
    ↓ 失败
Fetch API (keepalive)
    ↓ 失败
XMLHttpRequest (同步)
    ↓ 失败
Image Pixel (GET 降级)
```

**离线策略：** 网络断开时自动存入 IndexedDB → 网络恢复后自动重传 → 页面卸载前强制 flush。

---

### 会话回放 (`@monitor/replay`)

录制用户操作轨迹，精确回放问题现场：

```typescript
import { ReplayPlugin } from '@monitor/replay';

const plugin = new ReplayPlugin({
  flushInterval: 5000,          // 每 5 秒上报一次录制数据
  autoStart: true,              // 自动开始录制
  maxMutationBuffer: 500,       // DOM 变更缓冲上限
  sanitize: {
    maskPasswords: true,        // 密码输入脱敏
    maskEmails: true,           // 邮箱脱敏
    maskCreditCards: true,      // 银行卡号脱敏
    customSelectors: ['.sensitive'], // 自定义脱敏选择器
  },
  compression: {
    enable: true,
  },
});
```

**录制内容：**
- 页面初始 DOM 完整快照
- MutationObserver 增量变更（属性、文本、子节点）
- 用户交互事件（鼠标移动、点击、滚动、输入、窗口尺寸变化）
- 所有敏感数据自动脱敏处理

**播放引擎：** 支持 `play()` / `pause()` / `seekTo(timestamp)` / `setSpeed(rate)` 控制。

---

### 用户行为 (`@monitor/behavior`)

追踪用户行为模式，构建行为画像：

```typescript
import { BehaviorPlugin } from '@monitor/behavior';

const plugin = new BehaviorPlugin({
  click: {
    trackDoubleClick: true,     // 记录双击事件
    textMaxLength: 100,         // 元素文本截断长度
    selectorMaxDepth: 5,        // CSS 选择器最大深度
  },
  heatmap: {
    flushInterval: 10000,       // 热力图数据上报间隔
    dedupeInterval: 100,        // 去重间隔 (ms)
    maxPoints: 500,             // 最大缓冲数据点
  },
  journey: {
    maxSteps: 100,              // 最大路径步骤数
  },
  customEvents: {
    flushInterval: 5000,
    maxBuffer: 100,             // 最大缓冲事件数
  },
});

// 手动上报自定义行为事件
plugin.trackCustomEvent('add_to_cart', { productId: 'SKU_001', price: 99.9 });
```

**子模块：**

| 模块 | 说明 |
|------|------|
| ClickTracker | 生成元素 CSS 选择器路径、记录点击坐标和目标文本 |
| HeatmapCollector | 采集页面点击坐标分布，支持位置去重和批量上报 |
| UserJourneyTracker | 通过 History API monkey-patch 追踪页面导航路径和停留时长 |
| CustomEventsManager | 提供 `trackCustomEvent()` API，支持缓冲和批量上报 |

---

### Web Worker 线程池 (`@monitor/worker`)

将计算密集型任务卸载到 Worker 线程：

```typescript
import { WorkerPool } from '@monitor/worker';

const pool = new WorkerPool({
  workerScript: '/workers/compression.js',
  maxWorkers: 2,
  taskTimeout: 5000,
  fallback: async (type, payload) => {
    // Worker 不可用时的主线程降级处理
  },
});

const result = await pool.execute('compress', data);
pool.terminate();
```

**内置 Worker：**
- `compression.worker` — fflate gzip 压缩/解压
- `sourcemap.worker` — SourceMap VLQ 解码 + 堆栈帧还原

---

## 高级用法

### 自定义插件

```typescript
import type { Plugin, MonitorInterface } from '@monitor/types';

class MyPlugin implements Plugin {
  readonly name = 'my-plugin';
  readonly version = '1.0.0';

  install(monitor: MonitorInterface): void {
    // 订阅事件
    monitor.eventBus.on('event:captured', (event) => {
      console.log('Event captured:', event);
    });

    // 上报自定义数据
    monitor.captureEvent({
      type: 'custom',
      action: 'plugin_loaded',
    });
  }

  uninstall(): void {
    // 清理资源
  }
}
```

### beforeSend 数据脱敏

```typescript
const monitor = createMonitor({
  dsn: 'https://your-key@your-server.com/1',
  beforeSend(event) {
    // 过滤内部接口错误
    if (event.type === 'network' && event.url?.includes('/internal/')) {
      return null;
    }

    // 移除敏感信息
    if (event.context?.token) {
      delete event.context.token;
    }

    return event;
  },
});
```

### 动态采样

核心包内置 `DynamicSampler`：当错误率超过阈值时，自动降低非关键事件的采样率，保护服务端不被洪水般的数据打垮，同时确保错误事件始终 100% 采集。

```typescript
const monitor = createMonitor({
  dsn: 'https://your-key@your-server.com/1',
  sampleRate: 1.0,
  errorSampleRate: 1.0,          // 错误始终全采集
  performanceSampleRate: 0.5,    // 性能指标采样 50%
});
```

---

## 示例项目

在 `examples/` 目录下提供了三个即开即用的示例：

```bash
# 直接用浏览器打开
open examples/vanilla-js/index.html
open examples/react-app/index.html
open examples/vue-app/index.html
```

| 示例 | 技术栈 | 说明 |
|------|--------|------|
| `vanilla-js/` | 原生 HTML/JS | 最简集成示例，渐变 UI |
| `react-app/` | React 18 + Hooks | CDN 加载，useState/useEffect 集成 |
| `vue-app/` | Vue 3 Composition API | CDN 加载，响应式事件日志 |

---

## 开发指南

### 环境要求

- Node.js >= 20
- pnpm >= 9

### 初始化

```bash
git clone https://github.com/ShuaiFu29/monitor.git
cd monitor
pnpm install
```

### 常用命令

```bash
# 开发
pnpm dev                  # 启动所有包的 watch 模式
pnpm build                # 构建所有包 (ESM + CJS)

# 测试
pnpm test                 # 运行单元测试 (790 tests)
pnpm test:watch           # 测试监听模式
pnpm test:coverage        # 生成覆盖率报告
pnpm test:e2e             # Playwright E2E 测试 (13 tests)
pnpm test:benchmark       # 性能基准测试

# 代码质量
pnpm lint                 # ESLint 检查
pnpm lint:fix             # ESLint 自动修复
pnpm type-check           # TypeScript 类型检查

# 发布
pnpm changeset            # 创建变更集
pnpm release              # 构建 + 发布到 npm
```

### 项目结构

```
monitor/
├── packages/
│   ├── types/              # 公共类型定义
│   ├── utils/              # 工具函数
│   ├── core/               # 微内核
│   ├── browser/            # 浏览器入口
│   ├── error/              # 错误监控插件
│   ├── performance/        # 性能监控插件
│   ├── network/            # 网络监控插件
│   ├── transport/          # 数据传输插件
│   ├── replay/             # 会话回放插件
│   ├── behavior/           # 用户行为插件
│   └── worker/             # Web Worker 线程池
├── tests/
│   ├── e2e/                # Playwright E2E 测试
│   └── benchmark/          # 性能基准测试
├── examples/
│   ├── vanilla-js/         # 原生 JS 示例
│   ├── react-app/          # React 示例
│   └── vue-app/            # Vue 示例
├── .github/workflows/      # CI/CD 流水线
├── .changeset/             # Changeset 发布配置
├── vitest.config.ts        # 测试配置
├── eslint.config.mjs       # ESLint 配置
├── tsconfig.json           # TypeScript 配置
└── pnpm-workspace.yaml     # pnpm 工作区
```

### 质量门禁

CI 流水线强制执行以下检查：

| 检查项 | 阈值 |
|--------|------|
| TypeScript | 严格模式，0 error |
| ESLint | 0 error, 0 warning |
| 语句覆盖率 | ≥ 90% |
| 函数覆盖率 | ≥ 90% |
| 行覆盖率 | ≥ 90% |
| 分支覆盖率 | ≥ 85% |
| 核心包体积 | < 5 KB (gzip) |

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript 5.4 (strict mode) |
| 构建 | Rollup 4 (ESM + CJS + UMD) + Terser |
| 包管理 | pnpm 9 workspace monorepo |
| 单元测试 | Vitest + happy-dom |
| E2E 测试 | Playwright + Chromium |
| 代码规范 | ESLint 9 (flat config) + Prettier |
| 覆盖率 | @vitest/coverage-v8 |
| 发布 | @changesets/cli (fixed versioning) |
| CI/CD | GitHub Actions (Node 20 + 22) |
| 压缩 | fflate (gzip) |

---

## License

[MIT](LICENSE) © 2024-2026

---

<p align="center">
  <sub>Built with ❤️ for production-grade frontend observability.</sub>
</p>
