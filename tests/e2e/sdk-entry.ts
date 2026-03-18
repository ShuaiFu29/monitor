/**
 * E2E 测试专用 SDK 入口 — 打包成单文件 IIFE 供浏览器直接使用
 *
 * esbuild IIFE 格式会把 export 的内容作为 globalName 对象的属性暴露
 */
export { createMonitor } from '../../packages/browser/src/create-monitor';
export { Monitor } from '../../packages/core/src/monitor';
export { errorPlugin } from '../../packages/error/src/index';
export { performancePlugin } from '../../packages/performance/src/index';
export { networkPlugin } from '../../packages/network/src/index';
export { transportPlugin } from '../../packages/transport/src/index';
export { BehaviorPlugin } from '../../packages/behavior/src/index';
export { ReplayPlugin } from '../../packages/replay/src/index';
