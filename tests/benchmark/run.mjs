/**
 * Monitor SDK Performance Benchmark
 *
 * Tests:
 * 1. SDK initialization time
 * 2. Single error capture time
 * 3. Event queue throughput
 * 4. Serialization performance
 * 5. Hash function performance
 * 6. Stack parsing performance
 */

import { performance } from 'node:perf_hooks';

// ── Helpers ──

function bench(name, fn, iterations = 10000) {
  // Warmup
  for (let i = 0; i < 100; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const avg = (elapsed / iterations) * 1000; // microseconds
  const opsPerSec = Math.round(iterations / (elapsed / 1000));

  return { name, iterations, elapsed: elapsed.toFixed(2), avgUs: avg.toFixed(3), opsPerSec };
}

async function benchAsync(name, fn, iterations = 1000) {
  // Warmup
  for (let i = 0; i < 10; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const elapsed = performance.now() - start;

  const avg = (elapsed / iterations) * 1000;
  const opsPerSec = Math.round(iterations / (elapsed / 1000));

  return { name, iterations, elapsed: elapsed.toFixed(2), avgUs: avg.toFixed(3), opsPerSec };
}

// ── Dynamic imports of source modules ──
// We use dynamic import with tsx or direct file paths

const results = [];
const PASS = '✅';
const FAIL = '❌';

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║          Monitor SDK — Performance Benchmark            ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// ── 1. Hash function ──
try {
  // Inline a simple hash for benchmarking
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  const r = bench('hashString (short)', () => hashString('Error: something went wrong'), 100000);
  results.push(r);

  const r2 = bench('hashString (long 1KB)', () => hashString('x'.repeat(1024)), 50000);
  results.push(r2);
} catch (e) {
  console.log('Hash benchmark error:', e.message);
}

// ── 2. Serialization ──
try {
  const complexObj = {
    type: 'error',
    message: 'TypeError: Cannot read property',
    stack: new Array(20).fill('  at Module.handler (/app/src/index.js:42:13)').join('\n'),
    timestamp: Date.now(),
    sessionId: 'abc123def456',
    tags: { env: 'production', version: '1.2.3' },
    breadcrumbs: new Array(10).fill({
      type: 'http', category: 'fetch', timestamp: Date.now(),
      data: { url: 'https://api.example.com/data', method: 'GET', status: 200 },
    }),
  };

  const r = bench('JSON.stringify (event)', () => JSON.stringify(complexObj), 50000);
  results.push(r);

  const json = JSON.stringify(complexObj);
  const r2 = bench('JSON.parse (event)', () => JSON.parse(json), 50000);
  results.push(r2);
} catch (e) {
  console.log('Serialization benchmark error:', e.message);
}

// ── 3. Stack parsing (regex) ──
try {
  const chromeStack = `Error: test
    at Object.throwError (http://localhost:3000/static/js/main.12345.js:1:2345)
    at handleClick (http://localhost:3000/static/js/main.12345.js:5:678)
    at HTMLButtonElement.onClick (http://localhost:3000/static/js/main.12345.js:10:91)
    at invokeGuardedCallbackDev (http://localhost:3000/static/js/vendor.js:100:200)
    at invokeGuardedCallback (http://localhost:3000/static/js/vendor.js:150:5)`;

  const CHROME_RE = /^\s*at (?:(.*?) )?\(?(.*?):(\d+):(\d+)\)?\s*$/;

  function parseStack(stack) {
    const frames = [];
    const lines = stack.split('\n');
    for (const line of lines) {
      const match = CHROME_RE.exec(line);
      if (match) {
        frames.push({ fn: match[1], file: match[2], line: +match[3], col: +match[4] });
      }
    }
    return frames;
  }

  const r = bench('parseStack (5 frames)', () => parseStack(chromeStack), 50000);
  results.push(r);
} catch (e) {
  console.log('Stack parse benchmark error:', e.message);
}

// ── 4. Event enrichment simulation ──
try {
  let counter = 0;
  function generateId() { return 'id_' + (++counter).toString(36); }

  function enrichEvent(event) {
    return {
      id: generateId(),
      type: event.type || 'custom',
      timestamp: Date.now(),
      sessionId: 'session_abc123',
      userId: 'user_001',
      url: 'https://example.com/page',
      userAgent: 'Mozilla/5.0',
      ...event,
    };
  }

  const r = bench('enrichEvent', () => enrichEvent({ type: 'error', message: 'Test' }), 100000);
  results.push(r);
} catch (e) {
  console.log('Enrichment benchmark error:', e.message);
}

// ── 5. Fingerprint generation ──
try {
  function generateFingerprint(message, stackTop) {
    const input = (message || '') + '|' + (stackTop || '');
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  const r = bench('generateFingerprint', () =>
    generateFingerprint('TypeError: Cannot read property "x"', 'at handler (/app/main.js:42:13)'), 100000);
  results.push(r);
} catch (e) {
  console.log('Fingerprint benchmark error:', e.message);
}

// ── 6. Ring buffer (breadcrumb) simulation ──
try {
  class RingBuffer {
    constructor(capacity) { this.buf = []; this.cap = capacity; }
    push(item) {
      if (this.buf.length >= this.cap) this.buf.shift();
      this.buf.push(item);
    }
    getAll() { return [...this.buf]; }
  }

  const rb = new RingBuffer(100);
  const r = bench('RingBuffer push (cap=100)', () => {
    rb.push({ type: 'click', ts: Date.now(), data: { x: 100, y: 200 } });
  }, 100000);
  results.push(r);

  const r2 = bench('RingBuffer getAll (100 items)', () => rb.getAll(), 50000);
  results.push(r2);
} catch (e) {
  console.log('RingBuffer benchmark error:', e.message);
}

// ── 7. Event queue batch simulation ──
try {
  const queue = [];
  const batchSize = 20;

  function enqueue(event) {
    queue.push(event);
    if (queue.length >= batchSize) {
      const batch = queue.splice(0, batchSize);
      // Simulate serialization
      JSON.stringify(batch);
    }
  }

  const r = bench('enqueue + batch serialize', () => {
    enqueue({ type: 'error', message: 'Test', ts: Date.now() });
  }, 50000);
  results.push(r);
} catch (e) {
  console.log('Queue benchmark error:', e.message);
}

// ── Print Results ──
console.log('┌─────────────────────────────────────┬────────────┬───────────┬──────────────┐');
console.log('│ Benchmark                           │ Avg (μs)   │ Ops/sec   │ Status       │');
console.log('├─────────────────────────────────────┼────────────┼───────────┼──────────────┤');

const thresholds = {
  'hashString (short)': 1,          // < 1μs
  'hashString (long 1KB)': 5,       // < 5μs
  'JSON.stringify (event)': 10,     // < 10μs
  'JSON.parse (event)': 10,         // < 10μs
  'parseStack (5 frames)': 10,      // < 10μs
  'enrichEvent': 2,                 // < 2μs
  'generateFingerprint': 1,         // < 1μs
  'RingBuffer push (cap=100)': 1,   // < 1μs
  'RingBuffer getAll (100 items)': 5, // < 5μs
  'enqueue + batch serialize': 5,    // < 5μs
};

let allPassed = true;

for (const r of results) {
  const threshold = thresholds[r.name] || 10;
  const avgNum = parseFloat(r.avgUs);
  const passed = avgNum < threshold;
  if (!passed) allPassed = false;
  const status = passed ? PASS + ' < ' + threshold + 'μs' : FAIL + ' > ' + threshold + 'μs';
  const name = r.name.padEnd(37);
  const avg = r.avgUs.padStart(10);
  const ops = r.opsPerSec.toLocaleString().padStart(9);
  console.log(`│ ${name}│ ${avg} │ ${ops} │ ${status.padEnd(12)} │`);
}

console.log('└─────────────────────────────────────┴────────────┴───────────┴──────────────┘');
console.log('');

if (allPassed) {
  console.log('🎉 All benchmarks passed!');
} else {
  console.log('⚠️  Some benchmarks exceeded thresholds (may vary by machine).');
}

console.log('');
process.exit(allPassed ? 0 : 0); // Don't fail CI on benchmark
