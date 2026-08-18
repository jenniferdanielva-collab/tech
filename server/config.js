/**
 * Runtime configuration, all from the environment.
 *
 * Nothing secret is committed: bank details and API tokens live in a local .env
 * or in the process environment. See .env.example.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Minimal .env loader so the app runs with no dependencies installed. */
function loadDotEnv(file = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),

  ghl: {
    baseUrl: env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com',
    /** Private Integration token or OAuth access token for the location. */
    token: env.GHL_API_TOKEN ?? '',
    locationId: env.GHL_LOCATION_ID ?? '',
    /** LeadConnector pins behaviour to a dated API version. */
    apiVersion: env.GHL_API_VERSION ?? '2021-07-28',
    /** Optional: a tax record already set up in GoHighLevel. */
    taxId: env.GHL_TAX_ID ?? '',
    taxName: env.GHL_TAX_NAME ?? '',
    /** User id used as the sender when an invoice is emailed. */
    userId: env.GHL_USER_ID ?? '',
    /** false puts invoices in GoHighLevel's test mode. */
    liveMode: (env.GHL_LIVE_MODE ?? 'true') !== 'false',
    /** Email the invoice as soon as it is created. */
    autoSend: (env.GHL_AUTO_SEND ?? 'false') === 'true',
  },

  /** Payment details printed on the invoice. Left blank unless configured. */
  payment: {
    routingNumber: env.PAY_ROUTING_NUMBER ?? '',
    accountNumber: env.PAY_ACCOUNT_NUMBER ?? '',
    zelle: env.PAY_ZELLE ?? '',
    cardLink: env.PAY_CARD_LINK ?? '',
  },
};

/** True when there is enough configuration to actually reach GoHighLevel. */
export function ghlConfigured() {
  return Boolean(config.ghl.token && config.ghl.locationId);
}
