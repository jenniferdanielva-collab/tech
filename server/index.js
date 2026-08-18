/**
 * HTTP server for the tile calculator.
 *
 * Built on node:http with no dependencies, so `node server/index.js` runs it on
 * a clean machine with nothing installed.
 *
 *   GET  /                    the calculator UI
 *   GET  /api/catalog         formats, specialty pieces and default rates
 *   POST /api/calculate       costing only
 *   POST /api/invoice         costing plus invoice document
 *   POST /api/invoice/ghl     costing, invoice, and push to GoHighLevel
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, ghlConfigured } from './config.js';
import { pushInvoice, GhlError } from './ghl.js';
import { calculate } from '../src/calculator.js';
import { buildInvoice, renderInvoiceText } from '../src/invoice.js';
import { DEFAULTS, DEFAULT_DONOR_PRICING, SPECIALTY_ITEMS, TILE_FORMATS, BUSINESS } from '../src/catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

/** Read and parse a JSON body, refusing anything oversized. */
function readJsonBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Request body was not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Serve a static file, refusing any path that escapes the served directory.
 */
function serveStatic(res, urlPath) {
  const relative = urlPath === '/' ? 'public/index.html' : urlPath.replace(/^\/+/, '');
  const target = path.resolve(rootDir, relative);
  const allowed = [path.resolve(rootDir, 'public'), path.resolve(rootDir, 'src')];

  if (!allowed.some((dir) => target === dir || target.startsWith(dir + path.sep))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}

/** Shared first half of the invoice endpoints: cost the job, build the document. */
function costAndBuild(body) {
  const calculation = calculate(body.calculation ?? body);
  const invoice = buildInvoice(calculation, body.invoice ?? {});
  return { calculation, invoice };
}

const routes = {
  'GET /api/catalog': (_req, res) => {
    sendJson(res, 200, {
      tileFormats: TILE_FORMATS,
      specialtyItems: SPECIALTY_ITEMS,
      defaults: DEFAULTS,
      donorPricing: DEFAULT_DONOR_PRICING,
      business: BUSINESS,
      ghl: {
        configured: ghlConfigured(),
        autoSend: config.ghl.autoSend,
        liveMode: config.ghl.liveMode,
        taxHandledByGhl: Boolean(config.ghl.taxId),
      },
    });
  },

  'POST /api/calculate': async (req, res) => {
    const body = await readJsonBody(req);
    sendJson(res, 200, { calculation: calculate(body) });
  },

  'POST /api/invoice': async (req, res) => {
    const body = await readJsonBody(req);
    const { calculation, invoice } = costAndBuild(body);
    sendJson(res, 200, { calculation, invoice, text: renderInvoiceText(invoice) });
  },

  'POST /api/invoice/ghl': async (req, res) => {
    const body = await readJsonBody(req);
    const { calculation, invoice } = costAndBuild(body);

    const client = body.invoice?.client ?? body.client ?? {};
    if (ghlConfigured() && !client.email && (body.send ?? config.ghl.autoSend)) {
      sendJson(res, 400, { error: 'A client email address is required to send an invoice.' });
      return;
    }

    const result = await pushInvoice(invoice, { client, send: body.send });
    sendJson(res, 200, { calculation, invoice, ghl: result });
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const handler = routes[`${req.method} ${url.pathname}`];

  if (!handler) {
    // The page has no icon; answering rather than 403-ing keeps the console clean.
    if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    return sendJson(res, 404, { error: 'Not found' });
  }

  try {
    await handler(req, res);
  } catch (error) {
    if (error instanceof GhlError) {
      // Surface what GoHighLevel actually said; guessing helps nobody.
      sendJson(res, 502, { error: error.message, status: error.status ?? null, detail: error.body ?? null });
      return;
    }
    sendJson(res, 400, { error: error.message });
  }
});

server.listen(config.port, () => {
  console.log(`360 Studio Wild tile calculator running at http://localhost:${config.port}`);
  console.log(
    ghlConfigured()
      ? `GoHighLevel: connected to location ${config.ghl.locationId} (${config.ghl.liveMode ? 'live' : 'test'} mode)`
      : 'GoHighLevel: not configured — invoice pushes will return the payload as a dry run.',
  );
});

export { server };
