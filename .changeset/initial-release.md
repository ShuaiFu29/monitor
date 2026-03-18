---
"@monitor/types": major
"@monitor/utils": major
"@monitor/core": major
"@monitor/browser": major
"@monitor/error": major
"@monitor/performance": major
"@monitor/network": major
"@monitor/transport": major
"@monitor/replay": major
"@monitor/worker": major
"@monitor/behavior": major
---

## 1.0.0 — GA Release

### Features

- **@monitor/core**: Micro-kernel architecture with EventBus, PluginManager, ConfigManager, SessionManager, EventQueue, DynamicSampler
- **@monitor/error**: JS runtime error, Promise rejection, resource error capture; Chrome/Firefox/Safari stack parsing; fingerprint generation; breadcrumb ring buffer
- **@monitor/performance**: Web Vitals (LCP, FID, INP, CLS, TTFB, FCP), long task detection, resource timing
- **@monitor/network**: Fetch/XHR monkey-patch interception, W3C Trace Context propagation
- **@monitor/transport**: Beacon/Fetch/XHR/Image four-level fallback, exponential backoff retry, gzip compression, IndexedDB offline storage, unload handler, network recovery
- **@monitor/replay**: DOM snapshot serialization, MutationObserver incremental recording, user interaction capture, privacy sanitization, replay player with seekTo
- **@monitor/worker**: Web Worker thread pool with task queuing, timeout control, main-thread fallback; compression worker; sourcemap worker
- **@monitor/behavior**: Click tracker with CSS selector generation, heatmap collector, user journey tracker (History API), custom events manager
- **@monitor/browser**: `createMonitor()` entry point with unload and visibility handlers
