/**
 * @monitor/worker — Web Worker 线程池和任务卸载
 *
 * 将 CPU 密集操作（数据压缩、SourceMap 解析）从主线程移到 Worker 线程，
 * 避免阻塞 UI 渲染和用户交互。
 *
 * 核心组件：
 * - WorkerPool: 通用 Worker 线程池，支持任务排队、超时和主线程降级
 * - CompressionWorker: gzip 压缩/解压 Worker（可内联 Blob URL）
 * - SourceMapWorker: SourceMap 解析 Worker
 */
export { WorkerPool } from './pool';
export type { WorkerPoolConfig } from './pool';

export { handleCompressionMessage } from './compression.worker';
export { handleSourceMapMessage } from './sourcemap.worker';
export type { StackFrame, ResolvedFrame, RawSourceMap } from './sourcemap.worker';
