/**
 * GoHighLevel / LeadConnector API v2 client.
 *
 * Creating an invoice is three steps:
 *   1. upsert the client as a contact, so the invoice attaches to a real record
 *   2. create the invoice against the location
 *   3. optionally email it
 *
 * When no token is configured every call short-circuits into a dry run that
 * returns the payload it would have sent. The calculator and invoice generator
 * therefore work fully without GoHighLevel, and the payload can be inspected
 * before any credentials are handed over.
 */

import { config, ghlConfigured } from './config.js';
import { round } from '../src/calculator.js';

export class GhlError extends Error {
  constructor(message, { status, body, endpoint } = {}) {
    super(message);
    this.name = 'GhlError';
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

/** Every LeadConnector request carries a bearer token and a dated version. */
function headers() {
  return {
    Authorization: `Bearer ${config.ghl.token}`,
    Version: config.ghl.apiVersion,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * One API call, with a couple of retries on the failures that are worth
 * retrying: network drops, rate limiting, and 5xx. Client errors are not
 * retried, since sending the same bad payload again will not help.
 */
async function request(method, endpoint, body, { retries = 3 } = {}) {
  const url = `${config.ghl.baseUrl}${endpoint}`;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = 500 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      lastError = new GhlError(`Could not reach GoHighLevel: ${cause.message}`, { endpoint });
      continue;
    }

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (response.ok) return parsed;

    const retryable = response.status === 429 || response.status >= 500;
    lastError = new GhlError(
      `GoHighLevel ${method} ${endpoint} failed with ${response.status}: ${
        parsed?.message ?? parsed?.error ?? text.slice(0, 400)
      }`,
      { status: response.status, body: parsed, endpoint },
    );
    if (!retryable) throw lastError;
  }

  throw lastError;
}

/** Split a full name into the first/last fields the contacts API expects. */
function splitName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) };
}

/**
 * Create or update the client as a contact. Upsert matches on email or phone,
 * so re-invoicing the same client reuses their record instead of duplicating it.
 */
export async function upsertContact(client = {}) {
  const { firstName, lastName } = splitName(client.name);
  const address = client.address ?? {};

  const payload = {
    locationId: config.ghl.locationId,
    firstName,
    lastName,
    name: client.name || client.company || '',
    email: client.email || undefined,
    phone: client.phone || undefined,
    companyName: client.company || undefined,
    address1: address.line1 || undefined,
    city: address.city || undefined,
    state: address.state || undefined,
    postalCode: address.postalCode || undefined,
    country: address.country || 'US',
  };

  if (!ghlConfigured()) return { dryRun: true, endpoint: '/contacts/upsert', payload };

  const result = await request('POST', '/contacts/upsert', payload);
  const contact = result?.contact ?? result;
  return { dryRun: false, id: contact?.id ?? contact?._id ?? null, contact, payload };
}

/**
 * Map an invoice document onto the GoHighLevel invoice payload.
 *
 * Sales tax is handled one of two ways. If a tax record already exists in the
 * GoHighLevel account and its id is configured, it is attached to the goods
 * lines so GoHighLevel calculates and reports the tax itself. Otherwise the tax
 * is added as its own line item, which keeps the invoice total correct even
 * though GoHighLevel will not classify it as tax.
 */
export function toGhlInvoicePayload(invoice, { contactId } = {}) {
  const taxRecordConfigured = Boolean(config.ghl.taxId);

  const taxes = taxRecordConfigured
    ? [{
        _id: config.ghl.taxId,
        name: config.ghl.taxName || `Taxes ${invoice.tax.label}`,
        rate: round(invoice.tax.rate * 100, 4),
        calculation: 'exclusive',
      }]
    : [];

  const goods = invoice.lineItems.map((li) => ({
    name: li.description,
    description: li.detail ?? '',
    currency: invoice.currency,
    amount: li.unitPrice,
    qty: li.quantity,
    type: 'one_time',
    taxes,
  }));

  // Studio time, shipping and any flat VAT: fixed amounts, never taxed.
  const extras = invoice.adjustments.map((a) => ({
    name: a.label,
    description: '',
    currency: invoice.currency,
    amount: a.amount,
    qty: 1,
    type: 'one_time',
    taxes: [],
  }));

  // Only added when GoHighLevel is not calculating the tax itself.
  const taxLine = !taxRecordConfigured && invoice.tax.amount
    ? [{
        name: `Taxes ${invoice.tax.label} at ${invoice.tax.ratePercent}%`,
        description: 'Sales tax on goods subtotal',
        currency: invoice.currency,
        amount: invoice.tax.amount,
        qty: 1,
        type: 'one_time',
        taxes: [],
      }]
    : [];

  const address = invoice.billTo.address ?? {};

  return {
    altId: config.ghl.locationId,
    altType: 'location',
    name: `${invoice.for.title}${invoice.for.detail ? ` - ${invoice.for.detail}` : ''}`,
    title: invoice.title,
    currency: invoice.currency,
    invoiceNumber: invoice.invoiceNumber || undefined,
    issueDate: invoice.issueDateIso,
    dueDate: invoice.dueDateIso,
    liveMode: config.ghl.liveMode,

    businessDetails: {
      name: invoice.business.name,
      phoneNo: invoice.business.phone,
      address: {
        addressLine1: invoice.business.address.line1,
        city: invoice.business.address.city,
        state: invoice.business.address.state,
        postalCode: invoice.business.address.postalCode,
        countryCode: invoice.business.address.country,
      },
    },

    contactDetails: {
      id: contactId || undefined,
      name: invoice.billTo.name,
      email: invoice.billTo.email || undefined,
      phoneNo: invoice.billTo.phone || undefined,
      companyName: invoice.billTo.name,
      address: {
        addressLine1: address.line1 || undefined,
        city: address.city || undefined,
        state: address.state || undefined,
        postalCode: address.postalCode || undefined,
        countryCode: address.country || 'US',
      },
    },

    items: [...goods, ...extras, ...taxLine],
    discount: { type: 'percentage', value: 0 },
    termsNotes: invoice.terms,
    // Deposit terms and the costing that produced these numbers, so the invoice
    // in GoHighLevel can be traced back to a set of inputs.
    invoiceNotes: [
      invoice.notes,
      `${round(invoice.payment.depositRate * 100, 0)}% due on invoice: $${invoice.payment.depositDue.toFixed(2)}.`,
      `Balance due during shipping: $${invoice.payment.balanceDue.toFixed(2)}.`,
      `Priced ${invoice.basis.mode === 'per_tile' ? 'per tile' : 'per square foot'} over ${invoice.basis.squareFeet} sq ft at FX ${invoice.basis.fxRate}.`,
    ].filter(Boolean).join(' '),
  };
}

/** Create the invoice in GoHighLevel. */
export async function createInvoice(invoice, { contactId } = {}) {
  const payload = toGhlInvoicePayload(invoice, { contactId });
  if (!ghlConfigured()) return { dryRun: true, endpoint: '/invoices/', payload };

  const result = await request('POST', '/invoices/', payload);
  const created = result?.invoice ?? result;
  return { dryRun: false, id: created?._id ?? created?.id ?? null, invoice: created, payload };
}

/** Email the invoice to the client. */
export async function sendInvoice(invoiceId, { email, action = 'email' } = {}) {
  const payload = {
    altId: config.ghl.locationId,
    altType: 'location',
    action,
    liveMode: config.ghl.liveMode,
    userId: config.ghl.userId || undefined,
    sentTo: email ? { email: [email] } : undefined,
  };

  if (!ghlConfigured()) return { dryRun: true, endpoint: `/invoices/${invoiceId}/send`, payload };
  return { dryRun: false, result: await request('POST', `/invoices/${invoiceId}/send`, payload) };
}

/**
 * The whole flow: contact, invoice, and optionally the send.
 * Returns a step-by-step record so a partial failure is legible.
 */
export async function pushInvoice(invoice, { client = {}, send } = {}) {
  const steps = [];

  const contact = await upsertContact(client);
  steps.push({ step: 'contact', dryRun: contact.dryRun, id: contact.id ?? null });

  const created = await createInvoice(invoice, { contactId: contact.id });
  steps.push({ step: 'invoice', dryRun: created.dryRun, id: created.id ?? null });

  const shouldSend = send === undefined ? config.ghl.autoSend : send;
  let sent = null;
  if (shouldSend && (created.id || created.dryRun)) {
    sent = await sendInvoice(created.id ?? 'DRY_RUN_INVOICE_ID', { email: client.email });
    steps.push({ step: 'send', dryRun: sent.dryRun });
  }

  return {
    configured: ghlConfigured(),
    dryRun: !ghlConfigured(),
    contactId: contact.id ?? null,
    invoiceId: created.id ?? null,
    sent: Boolean(sent && !sent.dryRun),
    steps,
    payloads: { contact: contact.payload, invoice: created.payload },
  };
}
