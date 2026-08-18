/**
 * Calculator front end.
 *
 * The costing engine is imported straight from /src, so the tables update as
 * you type with no round trip. The server recalculates from the same inputs
 * before it touches GoHighLevel — the browser's numbers are for looking at, not
 * for billing.
 */

import { calculate, round } from '/src/calculator.js';
import { buildInvoice, renderInvoiceText } from '/src/invoice.js';
import { DEFAULT_DONOR_PRICING, SPECIALTY_ITEMS, TILE_FORMATS } from '/src/catalog.js';

const $ = (id) => document.getElementById(id);
const usd = (n) => (n === null || n === undefined ? '—' : `$${round(n, 2).toFixed(2)}`);
const pct = (n) => (n === null || n === undefined ? '—' : `${round(n * 100, 1).toFixed(1)}%`);
const qty = (n) => round(n, 2).toLocaleString('en-US');

let mode = 'per_sqft';

/* ---------------------------------------------------------------- *
 * Build the input rows that depend on the catalogue
 * ---------------------------------------------------------------- */

function buildTilePriceInputs() {
  $('tilePrices').innerHTML = TILE_FORMATS.map((f) => `
    <div class="field tile-price">
      <label>${f.label} — £ per tile</label>
      <input type="number" step="0.01" data-uk-price="${f.id}" value="${f.ukCostPerTile}">
    </div>`).join('');

  $('selectedFormat').innerHTML = TILE_FORMATS
    .map((f) => `<option value="${f.id}">${f.label}</option>`).join('');

  $('specialty').innerHTML = SPECIALTY_ITEMS.map((s) => `
    <div class="row" style="grid-template-columns: 1fr 90px; align-items:center; margin-bottom:6px">
      <span style="font-size:13px">${s.label} <span style="color:var(--ink-soft)">£${s.ukCostPerUnit}</span></span>
      <input type="number" min="0" step="1" data-specialty="${s.id}" value="0">
    </div>`).join('');

  $('donorPricing').innerHTML = [...TILE_FORMATS, ...SPECIALTY_ITEMS].map((item) => {
    const d = DEFAULT_DONOR_PRICING[item.id] ?? { low: '', high: '' };
    return `
      <div class="row three" style="align-items:center; margin-bottom:6px">
        <span style="font-size:13px">${item.label}</span>
        <input type="number" step="1" data-donor-low="${item.id}" value="${d.low}" aria-label="${item.label} low">
        <input type="number" step="1" data-donor-high="${item.id}" value="${d.high}" aria-label="${item.label} high">
      </div>`;
  }).join('');
}

/* ---------------------------------------------------------------- *
 * Gather the form into the engine's input shape
 * ---------------------------------------------------------------- */

function readInputs() {
  const numOf = (id) => {
    const raw = $(id).value.trim();
    return raw === '' ? undefined : Number(raw);
  };

  const formatOverrides = {};
  for (const el of document.querySelectorAll('[data-uk-price]')) {
    formatOverrides[el.dataset.ukPrice] = { ukCostPerTile: Number(el.value) };
  }

  const donorPricing = {};
  for (const el of document.querySelectorAll('[data-donor-low]')) {
    donorPricing[el.dataset.donorLow] = { low: el.value === '' ? null : Number(el.value) };
  }
  for (const el of document.querySelectorAll('[data-donor-high]')) {
    const id = el.dataset.donorHigh;
    donorPricing[id] = { ...donorPricing[id], high: el.value === '' ? null : Number(el.value) };
  }

  const specialty = [...document.querySelectorAll('[data-specialty]')]
    .map((el) => ({ id: el.dataset.specialty, quantity: Number(el.value) || 0 }));

  return {
    calculation: {
      mode,
      area: { squareFeet: numOf('squareFeet'), squareInches: numOf('squareInches') },
      rates: {
        bpPerSquareMetre: numOf('bpPerSquareMetre'),
        bpPerSquareFoot: numOf('bpPerSquareFoot'),
        deriveFromSquareMetre: $('deriveFromSquareMetre').checked,
        fxRate: numOf('fxRate'),
        tariffRate: numOf('tariffRate'),
        commissionRate: numOf('commissionRate'),
        taxRate: numOf('taxRate'),
        taxLabel: $('taxLabel').value,
        depositRate: numOf('depositRate'),
      },
      formatOverrides,
      donorPricing,
      specialty,
      selectedFormat: $('selectedFormat').value,
      studioTime: numOf('studioTime'),
      shippingSamples: numOf('shippingSamples'),
      shippingCompleted: numOf('shippingCompleted'),
    },
    invoice: {
      invoiceNumber: $('invoiceNumber').value,
      title: $('invoiceTitle').value,
      projectName: $('projectName').value,
      projectDetail: $('projectDetail').value,
      issueDate: $('issueDate').value || undefined,
      dueInDays: numOf('dueInDays'),
      priceBasis: $('priceBasis').value,
      billWholeTiles: $('billWholeTiles').checked,
      flatVat: numOf('flatVat'),
      client: {
        company: $('clientCompany').value,
        name: $('clientName').value,
        email: $('clientEmail').value,
        phone: $('clientPhone').value,
        address: {
          line1: $('clientLine1').value,
          city: $('clientCity').value,
          state: $('clientState').value,
          postalCode: $('clientPostal').value,
          country: 'US',
        },
      },
    },
  };
}

/* ---------------------------------------------------------------- *
 * Render the outputs
 * ---------------------------------------------------------------- */

function renderBasis(c) {
  const cards = [
    ['Project area', `${qty(c.area.squareFeet)} sq ft`],
    ['Square inches', qty(c.area.squareInches)],
    ['£ / sq ft', `£${round(c.basis.bpPerSquareFoot, 4)}`],
    ['$ / sq ft', usd(c.basis.usdPerSquareFoot)],
    ['Markup', `× ${round(c.basis.markupMultiplier, 3)}`],
    ['Invoice total', usd(c.totals.grandTotal)],
  ];
  $('basisCards').innerHTML = cards
    .map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');
}

function renderFormatTable(c) {
  const rows = [
    ['Tiles needed', (f) => qty(f.tilesNeeded)],
    ['Tiles to order', (f) => f.tilesToOrder.toLocaleString('en-US')],
    ['Tiles per sq ft', (f) => f.tilesPerSquareFoot],
    ['UK cost / tile', (f) => `£${round(f.ukCostPerTile, 4)}`],
    ['US cost / tile', (f) => usd(f.usCostPerTile)],
    ['Tile cost', (f) => usd(f.baseCost)],
    [`Tariff ${pct(c.rates.tariffRate)}`, (f) => usd(f.tariff)],
    [`Commission ${pct(c.rates.commissionRate)}`, (f) => usd(f.commission)],
    ['Total tile cost', (f) => usd(f.total), 'total'],
    [`Tax — ${c.rates.taxLabel}`, (f) => usd(f.salesTax), 'sub'],
    ['Add-ons + tax', (f) => usd(f.addOnsTotal), 'sub'],
    ['Project cost', (f) => usd(f.projectCost), 'total'],
  ];

  const head = `<thead><tr><th>Line</th>${
    c.formats.map((f) => `<th>${f.label}${f.id === c.totals.selectedFormat ? ' ★' : ''}</th>`).join('')
  }</tr></thead>`;

  const body = `<tbody>${rows.map(([label, get, cls]) => `
    <tr class="${cls ?? ''}"><td>${label}</td>${
      c.formats.map((f) => `<td class="num">${get(f)}</td>`).join('')
    }</tr>`).join('')}</tbody>`;

  $('formatTable').innerHTML = head + body;
}

function renderPricingSheet(c) {
  const head = `<thead><tr>
    <th>Item</th><th>Landed cost</th><th>Donor — low</th><th>Donor — high</th>
    <th>Low profit</th><th>High profit</th><th>Low margin</th></tr></thead>`;

  // Flag any row where the suggested donor price barely clears cost, which is
  // exactly the trap the 12x12 row in the source workbook falls into.
  const thin = [];
  const body = `<tbody>${c.pricingSheet.map((p) => {
    const cls = (v) => (v === null ? '' : v < 0 ? 'neg' : v < p.unitCost * 0.15 ? 'thin' : 'pos');
    if (p.lowProfit !== null && p.lowProfit < p.unitCost * 0.15) thin.push(p);
    return `<tr>
      <td>${p.label}</td>
      <td class="num">${usd(p.unitCost)}</td>
      <td class="num">${usd(p.donorLow)}</td>
      <td class="num">${usd(p.donorHigh)}</td>
      <td class="num ${cls(p.lowProfit)}">${usd(p.lowProfit)}</td>
      <td class="num ${cls(p.highProfit)}">${usd(p.highProfit)}</td>
      <td class="num ${cls(p.lowProfit)}">${pct(p.lowMarginPct)}</td>
    </tr>`;
  }).join('')}</tbody>`;

  $('pricingTable').innerHTML = head + body;
  $('pricingWarning').innerHTML = thin.length
    ? `<div class="note"><strong>Check these prices.</strong> ${
        thin.map((p) => `${p.label} costs ${usd(p.unitCost)} and is offered at ${usd(p.donorLow)}`).join('; ')
      } — under 15% margin.</div>`
    : '';
}

let latestInputs = null;

function recalculate() {
  latestInputs = readInputs();
  const calculation = calculate(latestInputs.calculation);
  const invoice = buildInvoice(calculation, latestInputs.invoice);

  renderBasis(calculation);
  renderFormatTable(calculation);
  renderPricingSheet(calculation);
  $('invoicePreview').textContent = renderInvoiceText(invoice);

  // Square inches win when both are filled in, so say so rather than leaving a
  // stale square-foot figure sitting in a box that is no longer being read.
  const overridden = calculation.area.source === 'square_inches';
  $('squareFeet').disabled = overridden;
  $('areaHint').textContent = overridden
    ? `Square inches are driving this quote — that is ${qty(calculation.area.squareFeet)} sq ft. Clear the square inches box to go back to entering square feet.`
    : 'Enter square inches directly when the wall was measured that way — the donor wall job was quoted at 77,140 sq in.';

  // In per-square-foot mode the tile price comes from the area, so the
  // per-tile inputs would be misleading.
  const perTile = mode === 'per_tile';
  document.querySelectorAll('.tile-price').forEach((el) => { el.style.display = perTile ? '' : 'none'; });
  $('sqftInputs').style.display = perTile ? 'none' : '';
  $('modeHint').textContent = perTile
    ? 'Each format has its own quoted price per tile, so the format you pick changes the total. This is how the donor wall was quoted.'
    : 'One base price per square foot is split across however many tiles fill it, so every format costs the same. This is how the Salvatore console was quoted.';
}

/* ---------------------------------------------------------------- *
 * GoHighLevel
 * ---------------------------------------------------------------- */

function setStatus(kind, message) {
  const el = $('ghlStatus');
  el.className = `status ${kind}`;
  el.textContent = message;
}

async function pushToGhl(send) {
  const buttons = [$('pushGhl'), $('sendGhl')];
  buttons.forEach((b) => { b.disabled = true; });
  setStatus('info', send ? 'Creating and emailing invoice…' : 'Creating invoice in GoHighLevel…');

  try {
    const response = await fetch('/api/invoice/ghl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...readInputs(), send }),
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus('err', data.error ?? `Request failed (${response.status})`);
      return;
    }
    if (data.ghl.dryRun) {
      setStatus('info',
        'GoHighLevel is not configured, so nothing was sent. The payload that would have been posted is in the downloadable JSON — ' +
        'set GHL_API_TOKEN and GHL_LOCATION_ID to go live.');
      return;
    }
    setStatus('ok',
      `Invoice ${data.invoice.invoiceNumber} created in GoHighLevel (id ${data.ghl.invoiceId})` +
      `${data.ghl.sent ? ' and emailed to the client' : ''}. Total ${usd(data.invoice.total)}.`);
  } catch (error) {
    setStatus('err', `Could not reach the server: ${error.message}`);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function loadGhlStatus() {
  try {
    const { ghl } = await (await fetch('/api/catalog')).json();
    const badge = $('ghlBadge');
    badge.textContent = ghl.configured
      ? `GoHighLevel: connected${ghl.liveMode ? '' : ' (test mode)'}`
      : 'GoHighLevel: not configured — dry run';
    badge.className = `badge ${ghl.configured ? 'on' : 'off'}`;
  } catch {
    $('ghlBadge').textContent = 'GoHighLevel: status unavailable';
  }
}

/* ---------------------------------------------------------------- *
 * Wire up
 * ---------------------------------------------------------------- */

buildTilePriceInputs();
$('issueDate').value = new Date().toISOString().slice(0, 10);

document.addEventListener('input', recalculate);
document.addEventListener('change', recalculate);

$('modeToggle').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  mode = button.dataset.mode;
  for (const b of $('modeToggle').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b === button));
  }
  recalculate();
});

$('pushGhl').addEventListener('click', () => pushToGhl(false));
$('sendGhl').addEventListener('click', () => pushToGhl(true));

$('downloadJson').addEventListener('click', () => {
  const calculation = calculate(latestInputs.calculation);
  const invoice = buildInvoice(calculation, latestInputs.invoice);
  const blob = new Blob([JSON.stringify({ inputs: latestInputs, calculation, invoice }, null, 2)],
    { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `360studiowild-costing-${invoice.invoiceNumber || 'draft'}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

recalculate();
loadGhlStatus();
