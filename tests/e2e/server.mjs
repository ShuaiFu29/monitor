// E2E Test Server
// - Serves static HTML pages from tests/e2e/fixtures/
// - Serves the built SDK bundles from packages
// - Provides /api/report, /api/events, /api/clear endpoints

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

let recordedEvents = [];

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Trace-Id, X-Span-Id, traceparent',
    });
    res.end();
    return;
  }

  // ── API routes ──

  if (url.pathname === '/api/report' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const events = JSON.parse(body.toString());
      if (Array.isArray(events)) {
        recordedEvents.push(...events);
      } else {
        recordedEvents.push(events);
      }
    } catch {
      // May be compressed or raw — store raw
      recordedEvents.push({ raw: body.toString() });
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(recordedEvents));
    return;
  }

  if (url.pathname === '/api/clear' && req.method === 'POST') {
    recordedEvents = [];
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Static files ──

  // /fixtures/* → tests/e2e/fixtures/*
  if (url.pathname.startsWith('/fixtures/')) {
    serveStatic(res, path.join(__dirname, url.pathname));
    return;
  }

  // /sdk/* → serve built SDK from packages
  if (url.pathname.startsWith('/sdk/')) {
    const sdkPath = url.pathname.replace('/sdk/', '');
    serveStatic(res, path.join(ROOT, sdkPath));
    return;
  }

  // Default: serve fixture index
  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveStatic(res, path.join(__dirname, 'fixtures/index.html'));
    return;
  }

  // Try fixtures directory
  serveStatic(res, path.join(__dirname, 'fixtures', url.pathname));
});

const PORT = 3456;
server.listen(PORT, () => {
  console.log(`E2E test server running on http://localhost:${PORT}`);
});
