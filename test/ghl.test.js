/**
 * Tests for the GoHighLevel mapping.
 *
 * No live account is involved: these cover the part that is entirely ours --
 * turning an invoice document into the payload, and the dry-run behaviour that
 * lets the app run unconfigured. The most important assertion is that the
 * payload's own line items add up to the invoice total, because that is what
 * silently going wrong would cost real money.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { calculate, round } from '../src/calculator.js';
import { buildInvoice } from '../src/invoice.js';
import { toGhlInvoicePayload, pushInvoice, upsertContact } from '../server/ghl.js';
import { config } from '../server/config.js';

const client = {
  company: 'Meals on Wheels',
  name: 'Chelsea Eifert',
  email: 'chelsea@example.org',
  phone: '+15135551234',
  address: { line1: '1 Main St', city: 'San Francisco', state: 'CA', postalCode: '94110', country: 'US' },
};

/** A representative donor-wall invoice: tiles, specialty pieces, add-ons, tax. */
function sampleInvoice(overrides = {}) {
  const calculation = calculate({
    mode: 'per_tile',
    area: { squareInches: 77140 },
    selectedFormat: '6x6',
    specialty: [{ id: 'platter', quantity: 2 }],
    rates: { taxRate: 0.08625, taxLabel: 'California 94110' },
    studioTime: 85,
    shippingSamples: 50,
    shippingCompleted: 269.5,
  });
  return buildInvoice(calculation, {
    invoiceNumber: '7',
    client,
    projectName: 'Custom Designed Mural Tiles',
    projectDetail: 'Donor Wall',
    issueDate: '2026-08-18',
    ...overrides,
  });
}

/** Sum a payload's line items the way GoHighLevel will. */
const sumItems = (payload) => round(payload.items.reduce((t, i) => t + i.amount * i.qty, 0), 2);

/** Swap a config value for one test and always put it back. */
function withConfig(patch, fn) {
  const original = { ...config.ghl };
  Object.assign(config.ghl, patch);
  try {
    return fn();
  } finally {
    Object.assign(config.ghl, original);
  }
}

test('payload line items add up to the invoice total', () => {
  const invoice = sampleInvoice();
  const payload = toGhlInvoicePayload(invoice);
  assert.equal(sumItems(payload), invoice.total, 'GoHighLevel would bill the invoice total');
});

test('every billable line reaches the payload', () => {
  const invoice = sampleInvoice();
  const names = toGhlInvoicePayload(invoice).items.map((i) => i.name);

  assert.ok(names.includes('6x6 Inch Tiles'), 'the tile format');
  assert.ok(names.includes('Platter'), 'the specialty pieces');
  assert.ok(names.includes('Studio Time'), 'studio time');
  assert.ok(names.includes('Estimated Shipping--Samples'), 'sample shipping');
  assert.ok(names.includes('Estimated Shipping--Completed Tiles'), 'completed-tile shipping');
  assert.equal(names.length, invoice.lineItems.length + invoice.adjustments.length + 1, 'plus one tax line');
});

test('quantities and unit prices survive the mapping', () => {
  const invoice = sampleInvoice();
  const payload = toGhlInvoicePayload(invoice);

  for (const line of invoice.lineItems) {
    const item = payload.items.find((i) => i.name === line.description);
    assert.ok(item, `${line.description} is on the payload`);
    assert.equal(item.qty, line.quantity, `${line.description} quantity`);
    assert.equal(item.amount, line.unitPrice, `${line.description} unit price`);
  }
});

test('without a GoHighLevel tax record the tax becomes its own line', () => {
  withConfig({ taxId: '' }, () => {
    const invoice = sampleInvoice();
    const payload = toGhlInvoicePayload(invoice);

    const taxLine = payload.items.find((i) => i.name.startsWith('Taxes'));
    assert.ok(taxLine, 'a tax line item is added');
    assert.equal(taxLine.amount, invoice.tax.amount, 'for the calculated tax');
    assert.ok(payload.items.every((i) => i.taxes.length === 0), 'nothing carries a tax record');
    assert.equal(sumItems(payload), invoice.total, 'total still reconciles');
  });
});

test('with a GoHighLevel tax record the goods carry it and no tax line is added', () => {
  withConfig({ taxId: 'tax_abc123', taxName: 'CA Sales Tax' }, () => {
    const invoice = sampleInvoice();
    const payload = toGhlInvoicePayload(invoice);

    assert.ok(!payload.items.some((i) => i.name.startsWith('Taxes')), 'no separate tax line');

    // Goods are taxed; shipping and studio time are not.
    const goods = payload.items.filter((i) => ['6x6 Inch Tiles', 'Platter'].includes(i.name));
    assert.equal(goods.length, 2, 'both goods lines found');
    for (const item of goods) {
      assert.equal(item.taxes.length, 1, `${item.name} carries the tax record`);
      assert.equal(item.taxes[0]._id, 'tax_abc123', 'by id');
      assert.equal(item.taxes[0].rate, 8.625, 'as a percentage, not a fraction');
      assert.equal(item.taxes[0].calculation, 'exclusive', 'added on top, not backed out');
    }
    for (const item of payload.items.filter((i) => i.name.includes('Shipping') || i.name === 'Studio Time')) {
      assert.equal(item.taxes.length, 0, `${item.name} is not taxed`);
    }

    // GoHighLevel adds the tax itself, so the items sum to the pre-tax figure.
    assert.equal(sumItems(payload), round(invoice.total - invoice.tax.amount, 2), 'items are the pre-tax total');
  });
});

test('a flat VAT line is carried through', () => {
  const invoice = sampleInvoice({ flatVat: 16.2 });
  const payload = toGhlInvoicePayload(invoice);
  const vat = payload.items.find((i) => i.name === 'VAT');
  assert.ok(vat, 'VAT line present');
  assert.equal(vat.amount, 16.2);
  assert.equal(sumItems(payload), invoice.total, 'total reconciles with VAT on it');
});

test('the invoice is addressed to the location and the contact', () => {
  withConfig({ locationId: 'loc_123' }, () => {
    const payload = toGhlInvoicePayload(sampleInvoice(), { contactId: 'contact_456' });

    assert.equal(payload.altId, 'loc_123', 'location id');
    assert.equal(payload.altType, 'location');
    assert.equal(payload.contactDetails.id, 'contact_456', 'linked to the contact');
    assert.equal(payload.contactDetails.email, client.email);
    assert.equal(payload.contactDetails.address.postalCode, '94110');
    assert.equal(payload.businessDetails.name, '360 Studio Wild, LLC');
  });
});

test('dates are sent as ISO, not as the printed US format', () => {
  const payload = toGhlInvoicePayload(sampleInvoice());
  assert.match(payload.issueDate, /^\d{4}-\d{2}-\d{2}$/, 'issue date');
  assert.match(payload.dueDate, /^\d{4}-\d{2}-\d{2}$/, 'due date');
  assert.equal(payload.issueDate, '2026-08-18');
});

test('deposit terms travel with the invoice', () => {
  const invoice = sampleInvoice();
  const payload = toGhlInvoicePayload(invoice);
  assert.ok(payload.invoiceNotes.includes(invoice.payment.depositDue.toFixed(2)), 'deposit amount');
  assert.ok(payload.termsNotes.includes('360 Studio Wild'), 'payment terms');
});

test('a single-word contact name does not lose the name', async () => {
  const result = await upsertContact({ name: 'Cher', email: 'cher@example.org' });
  assert.equal(result.payload.firstName, 'Cher');
  assert.equal(result.payload.lastName, '');
});

test('a multi-part surname keeps its pieces together', async () => {
  const result = await upsertContact({ name: 'Ada Van Der Berg' });
  assert.equal(result.payload.firstName, 'Ada Van Der');
  assert.equal(result.payload.lastName, 'Berg');
});

test('unconfigured, the push is a dry run that sends nothing', async () => {
  await withConfig({ token: '', locationId: '' }, async () => {
    // Fail loudly if anything tries to reach the network.
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('a dry run must not call the API'); };
    try {
      const result = await pushInvoice(sampleInvoice(), { client, send: true });
      assert.equal(result.dryRun, true);
      assert.equal(result.configured, false);
      assert.equal(result.sent, false, 'nothing was emailed');
      assert.ok(result.payloads.invoice, 'the payload is returned for inspection');
      assert.ok(result.payloads.contact, 'including the contact payload');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
