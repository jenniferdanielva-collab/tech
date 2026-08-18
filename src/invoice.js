/**
 * Turns a costing result into an invoice document laid out like the studio's
 * existing proforma (proforma_standard_1.pdf):
 *
 *     DESCRIPTION / QUANTITY / UNIT PRICE / NET PRICE
 *     ... line items ...
 *     Subtotal
 *     VAT, Studio Time, Estimated Shipping (samples and completed tiles)
 *     Taxes <jurisdiction> at <rate>%
 *     TOTAL
 *
 * The document recomputes its own totals from its own line items rather than
 * inheriting them from the calculator. That matters because a project needs a
 * whole number of tiles: the calculator keeps fractional counts so its figures
 * tie back to the workbooks, while the invoice bills 2143 tiles rather than
 * 2142.78. Set `billWholeTiles: false` to invoice the fractional count instead.
 */

import { BUSINESS, DEFAULTS } from './catalog.js';
import { round } from './calculator.js';

/** Cents-accurate money helper so line items and totals always agree. */
const money = (n) => round(n, 2);

function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/** ISO date (YYYY-MM-DD), which is what the GoHighLevel API expects. */
function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const d = new Date(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Choose the price charged per piece.
 *   cost       - landed cost: US price plus tariff and commission. What the
 *                studio bills a design client.
 *   donor_low  - the low suggested donor price from the pricing sheet.
 *   donor_high - the high suggested donor price.
 */
function unitPriceFor(line, basis, pricingSheet) {
  if (basis === 'cost') return line.landedUnitCost;
  const entry = pricingSheet.find((p) => p.id === line.id);
  const price = basis === 'donor_high' ? entry?.donorHigh : entry?.donorLow;
  // Fall back to cost rather than invoicing a zero if no donor price is set.
  return price === null || price === undefined ? line.landedUnitCost : price;
}

/**
 * Build the invoice.
 *
 * @param {object} calculation   Output of `calculate()`.
 * @param {object} [options]
 * @param {string} [options.invoiceNumber]
 * @param {string} [options.title]          "PROFORMA" or "INVOICE".
 * @param {object} [options.client]         { name, company, email, phone, address }.
 * @param {string} [options.projectName]    Appears in the FOR column.
 * @param {string} [options.projectDetail]  Second line of the FOR column.
 * @param {string|Date} [options.issueDate]
 * @param {number} [options.dueInDays]      Defaults to 14.
 * @param {'cost'|'donor_low'|'donor_high'} [options.priceBasis]
 * @param {boolean} [options.billWholeTiles] Defaults to true.
 * @param {number} [options.flatVat]        Fixed VAT line, as on the proforma.
 */
export function buildInvoice(calculation, options = {}) {
  const {
    invoiceNumber = '',
    title = 'PROFORMA',
    client = {},
    projectName = '',
    projectDetail = '',
    priceBasis = 'cost',
    billWholeTiles = true,
    flatVat = 0,
    notes = '',
  } = options;

  const issueDate = options.issueDate ? new Date(options.issueDate) : new Date();
  const dueDate = options.dueDate ? new Date(options.dueDate) : addDays(issueDate, options.dueInDays ?? 14);

  const { totals, pricingSheet, addOns, rates } = calculation;

  // The chosen tile format, plus any specialty pieces with a quantity on them.
  const selected = calculation.formats.find((f) => f.id === totals.selectedFormat);
  const billable = [
    ...(selected ? [selected] : []),
    ...calculation.specialty.filter((s) => s.quantity > 0),
  ];

  const lineItems = billable.map((line) => {
    const quantity = line.kind === 'specialty'
      ? line.quantity
      : billWholeTiles
        ? line.tilesToOrder
        : round(line.tilesNeeded, 2);
    const unitPrice = money(unitPriceFor(line, priceBasis, pricingSheet));
    return {
      id: line.id,
      description: line.label,
      detail: line.kind === 'tile'
        ? `${line.side}x${line.side} inch, ${line.tilesPerSquareFoot} per sq ft`
        : 'Specialty piece',
      quantity,
      unitPrice,
      netPrice: money(quantity * unitPrice),
    };
  });

  const subtotal = money(lineItems.reduce((sum, li) => sum + li.netPrice, 0));

  // Fixed lines below the subtotal. The proforma carries a flat VAT amount
  // separately from the local sales tax, so both are supported.
  const adjustments = [
    ...(flatVat ? [{ label: 'VAT', quantity: 1, amount: money(flatVat) }] : []),
    ...addOns.map((a) => ({ label: a.label, quantity: 1, amount: money(a.amount) })),
  ];
  const adjustmentsTotal = money(adjustments.reduce((sum, a) => sum + a.amount, 0));

  // Sales tax applies to the goods subtotal only, never to shipping or studio
  // time -- matching both the workbooks and the proforma.
  const tax = {
    label: rates.taxLabel,
    rate: rates.taxRate,
    ratePercent: round(rates.taxRate * 100, 3),
    amount: money(subtotal * rates.taxRate),
  };

  const total = money(subtotal + adjustmentsTotal + tax.amount);
  const depositRate = rates.depositRate ?? DEFAULTS.depositRate;
  const depositDue = money(total * depositRate);

  return {
    title,
    invoiceNumber: String(invoiceNumber),
    issueDate: formatDate(issueDate),
    dueDate: formatDate(dueDate),
    issueDateIso: isoDate(issueDate),
    dueDateIso: isoDate(dueDate),
    currency: 'USD',

    business: BUSINESS,
    billTo: {
      name: client.company || client.name || '',
      contact: client.name || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || {},
    },
    for: {
      title: projectName || BUSINESS.productLine,
      detail: projectDetail,
    },

    lineItems,
    subtotal,
    adjustments,
    adjustmentsTotal,
    tax,
    total,

    payment: {
      depositRate,
      depositDue,
      balanceDue: money(total - depositDue),
    },
    terms: BUSINESS.terms,
    notes,

    /** Kept for reference so the invoice can be traced back to its costing. */
    basis: {
      mode: calculation.mode,
      squareFeet: round(calculation.area.squareFeet, 2),
      squareInches: round(calculation.area.squareInches, 2),
      priceBasis,
      billWholeTiles,
      fxRate: rates.fxRate,
      tariffRate: rates.tariffRate,
      commissionRate: rates.commissionRate,
      fractionalTileSubtotal: money(totals.subtotal),
    },
  };
}

/** Plain-text rendering of the invoice, laid out like the studio's proforma. */
export function renderInvoiceText(inv) {
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  const usd = (n) => `$${money(n).toFixed(2)}`;
  const out = [];

  out.push(`${inv.business.productLine}${' '.repeat(20)}${inv.title}`);
  out.push(inv.business.tagline);
  out.push('');
  out.push(`Represented by: ${inv.business.name}`);
  out.push(`${inv.business.address.line1}`);
  out.push(`${inv.business.address.city}, ${inv.business.address.state} ${inv.business.address.postalCode}`);
  out.push(inv.business.phone);
  out.push('');
  out.push(`INVOICE: ${inv.invoiceNumber}`);
  out.push(`DATE:    ${inv.issueDate}`);
  out.push(`DUE:     ${inv.dueDate}`);
  out.push('');
  out.push(`TO:  ${inv.billTo.name}`);
  if (inv.billTo.address?.line1) out.push(`     ${inv.billTo.address.line1}`);
  if (inv.billTo.address?.city) {
    out.push(`     ${inv.billTo.address.city}, ${inv.billTo.address.state ?? ''} ${inv.billTo.address.postalCode ?? ''}`.trimEnd());
  }
  out.push(`FOR: ${inv.for.title}`);
  if (inv.for.detail) out.push(`     ${inv.for.detail}`);
  out.push('');
  out.push(`${pad('DESCRIPTION', 44)}${lpad('QUANTITY', 10)}${lpad('UNIT PRICE', 14)}${lpad('NET PRICE', 14)}`);
  out.push('-'.repeat(82));
  for (const li of inv.lineItems) {
    out.push(`${pad(li.description, 44)}${lpad(li.quantity, 10)}${lpad(usd(li.unitPrice), 14)}${lpad(usd(li.netPrice), 14)}`);
  }
  out.push('-'.repeat(82));
  out.push(`${pad('Subtotal', 68)}${lpad(usd(inv.subtotal), 14)}`);
  for (const a of inv.adjustments) {
    out.push(`${pad(a.label, 68)}${lpad(usd(a.amount), 14)}`);
  }
  out.push(`${pad(`Taxes ${inv.tax.label} at ${inv.tax.ratePercent}%`, 68)}${lpad(usd(inv.tax.amount), 14)}`);
  out.push(`${pad('TOTAL', 68)}${lpad(usd(inv.total), 14)}`);
  out.push('');
  out.push(`${round(inv.payment.depositRate * 100, 0)}% due on invoice: ${usd(inv.payment.depositDue)}`);
  out.push(`Balance due during shipping: ${usd(inv.payment.balanceDue)}`);
  out.push('');
  out.push(inv.terms);
  return out.join('\n');
}
