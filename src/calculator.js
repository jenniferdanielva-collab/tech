/**
 * 360 Studio Wild — tile project cost engine.
 *
 * This reproduces the two source workbooks exactly, in one engine:
 *
 *   Per-square-foot mode  (Salvatore Console workbook)
 *     A base price is quoted per square foot (£5.67, itself derived from £61/m2).
 *     The cost of a single tile is that base divided by how many of that tile fit
 *     in a square foot, so every format costs the same for a given area.
 *
 *   Per-tile mode  (Meals on Wheels donor wall workbook)
 *     Each format has its own quoted price per tile, so format choice changes the
 *     project total. The donor wall sheet notes this explicitly:
 *     "Calculations based upon Per Tile cost rather than Per Sq Ft cost".
 *
 * The cost stack is identical in both modes:
 *     GBP cost/tile -> x FX -> USD cost/tile -> x tiles -> base cost
 *     + tariff (10%) + commission (40%)      -> total tile cost
 *     + sales tax on the tile subtotal
 *     + fixed add-ons (studio time, shipping) -> project cost
 */

import {
  DEFAULTS,
  DEFAULT_DONOR_PRICING,
  SPECIALTY_BY_ID,
  SPECIALTY_ITEMS,
  SQFT_PER_SQM,
  SQIN_PER_SQFT,
  TILE_FORMATS,
  TILE_FORMAT_BY_ID,
} from './catalog.js';

/**
 * Round to `places` decimals, half away from zero, matching how a spreadsheet
 * rounds money.
 *
 * Two separate sources of drift have to be dealt with:
 *
 *  1. The value arriving here is already slightly off. A donor price of 10 less
 *     a landed cost of 6.075 comes out as 3.924999999999999 rather than 3.925,
 *     so rounding it honestly gives 3.92 where the workbook shows 3.93.
 *     Normalising to 12 significant figures first snaps it back to 3.925 —
 *     the same trick a spreadsheet uses, and far more precision than money
 *     figures of this size need.
 *
 *  2. Scaling by a power of ten introduces fresh drift, so the decimal point is
 *     moved through exponent notation instead, which stays exact.
 *
 * Rounding is half away from zero, so a loss rounds like a gain — Math.round on
 * its own would send -0.5 up to -0.
 */
export function round(value, places = 2) {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const normalised = Number(Math.abs(value).toPrecision(12));
  const shifted = Number(`${normalised}e${places}`);
  if (!Number.isFinite(shifted)) return value;
  return sign * Number(`${Math.round(shifted)}e-${places}`);
}

function num(value, fallback = 0) {
  const n = typeof value === 'string' ? Number(value.replace(/[$,£\s]/g, '')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Accept a rate as either a fraction (0.1) or a percentage (10) and normalise to
 * a fraction. Anything above 1 is read as a percentage, which is how people
 * actually type tariff and commission.
 */
function rate(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = num(value, fallback);
  return n > 1 ? n / 100 : n;
}

/** Resolve the area of the job. An explicit square-inch figure always wins. */
export function resolveArea(area = {}) {
  const squareInches = num(area.squareInches, 0);
  if (squareInches > 0) {
    return {
      squareInches,
      squareFeet: squareInches / SQIN_PER_SQFT,
      source: 'square_inches',
    };
  }
  const squareFeet = num(area.squareFeet, 0);
  return {
    squareFeet,
    squareInches: squareFeet * SQIN_PER_SQFT,
    source: 'square_feet',
  };
}

/**
 * Work out the GBP base price per square foot. If `deriveFromSquareMetre` is on,
 * it is converted from the £/m2 figure; otherwise the directly-entered £/sq ft
 * value is used, which is what the Salvatore workbook does (it carries 5.67
 * alongside 61/m2 rather than recomputing).
 */
export function resolveBasePrice(rates = {}) {
  const bpPerSquareMetre = num(rates.bpPerSquareMetre, DEFAULTS.bpPerSquareMetre);
  const derive = Boolean(rates.deriveFromSquareMetre);
  const bpPerSquareFoot = derive
    ? bpPerSquareMetre / SQFT_PER_SQM
    : num(rates.bpPerSquareFoot, DEFAULTS.bpPerSquareFoot);
  return { bpPerSquareMetre, bpPerSquareFoot, derivedFromSquareMetre: derive };
}

/** Normalise every rate on the input into a single settings object. */
export function resolveRates(rates = {}) {
  const base = resolveBasePrice(rates);
  return {
    ...base,
    fxRate: num(rates.fxRate, DEFAULTS.fxRate),
    tariffRate: rate(rates.tariffRate, DEFAULTS.tariffRate),
    commissionRate: rate(rates.commissionRate, DEFAULTS.commissionRate),
    taxRate: rate(rates.taxRate, DEFAULTS.taxRate),
    taxLabel: rates.taxLabel ?? DEFAULTS.taxLabel,
    depositRate: rate(rates.depositRate, DEFAULTS.depositRate),
  };
}

/**
 * Apply the markup stack to a base cost.
 * Tariff and commission are both charged on the base, never compounded on each
 * other — matching `=SUM(K15*0.1)` and `=SUM(K15*0.4)` in the workbooks.
 */
function markup(baseCost, r) {
  const tariff = baseCost * r.tariffRate;
  const commission = baseCost * r.commissionRate;
  return { baseCost, tariff, commission, total: baseCost + tariff + commission };
}

/** The multiplier from landed-in-USD to sell price: 1 + tariff + commission. */
export function markupMultiplier(r) {
  return 1 + r.tariffRate + r.commissionRate;
}

/**
 * Cost one tile format across the whole project area.
 *
 * Tile count comes from square inches divided by the tile's face area, which is
 * what both workbooks do (`=SUM(F5/16)` for a 4x4). Fractional tiles are kept
 * for the money so the figures tie back to the sheets, and a separate rounded-up
 * count is reported for what actually has to be ordered.
 */
export function costFormat(format, ctx) {
  const { area, rates: r, mode, overrides } = ctx;
  const override = overrides?.[format.id] ?? {};

  const ukCostPerTile =
    mode === 'per_sqft'
      ? r.bpPerSquareFoot / format.perSqFt
      : num(override.ukCostPerTile, format.ukCostPerTile);

  const usCostPerTile = ukCostPerTile * r.fxRate;
  const tilesNeeded =
    override.tilesNeeded !== undefined && override.tilesNeeded !== ''
      ? num(override.tilesNeeded)
      : area.squareInches / (format.side * format.side);

  const stack = markup(tilesNeeded * usCostPerTile, r);

  return {
    id: format.id,
    label: format.label,
    kind: 'tile',
    side: format.side,
    tilesPerSquareFoot: format.perSqFt,
    tilesNeeded,
    tilesToOrder: Math.ceil(tilesNeeded),
    ukCostPerTile,
    usCostPerTile,
    /** What one tile costs the client once tariff and commission are on it. */
    landedUnitCost: usCostPerTile * markupMultiplier(r),
    ...stack,
  };
}

/** Cost a specialty piece (plates, platters) by quantity rather than by area. */
export function costSpecialty(entry, ctx) {
  const def = SPECIALTY_BY_ID.get(entry.id) ?? {};
  const { rates: r } = ctx;
  const ukCostPerUnit = num(entry.ukCostPerUnit, def.ukCostPerUnit ?? 0);
  const usCostPerUnit = ukCostPerUnit * r.fxRate;
  const quantity = num(entry.quantity, 0);
  const stack = markup(quantity * usCostPerUnit, r);

  return {
    id: entry.id,
    label: entry.label ?? def.label ?? entry.id,
    kind: 'specialty',
    quantity,
    tilesToOrder: quantity,
    ukCostPerTile: ukCostPerUnit,
    usCostPerTile: usCostPerUnit,
    landedUnitCost: usCostPerUnit * markupMultiplier(r),
    ...stack,
  };
}

/** Fixed-amount lines: studio time, shipping, and anything else typed in. */
function resolveAddOns(input, r) {
  if (Array.isArray(input.addOns)) {
    return input.addOns
      .filter((a) => a && a.label)
      .map((a) => ({ label: a.label, amount: num(a.amount, 0) }))
      .filter((a) => a.amount !== 0);
  }
  return [
    { label: 'Studio Time', amount: num(input.studioTime, DEFAULTS.studioTime) },
    { label: 'Estimated Shipping--Samples', amount: num(input.shippingSamples, DEFAULTS.shippingSamples) },
    { label: 'Estimated Shipping--Completed Tiles', amount: num(input.shippingCompleted, DEFAULTS.shippingCompleted) },
  ].filter((a) => a.amount !== 0);
}

/**
 * Build the client-facing pricing sheet: what each piece costs landed, what a
 * donor is asked for, and the margin between the two. Mirrors the
 * "Client Pricing Sheet" tab of the donor wall workbook.
 */
export function buildPricingSheet(lines, donorPricing) {
  return lines.map((line) => {
    const donor = donorPricing?.[line.id] ?? DEFAULT_DONOR_PRICING[line.id] ?? {};
    const low = donor.low === undefined ? null : num(donor.low);
    const high = donor.high === undefined ? null : num(donor.high);
    return {
      id: line.id,
      label: line.label,
      unitCost: line.landedUnitCost,
      donorLow: low,
      donorHigh: high,
      lowProfit: low === null ? null : low - line.landedUnitCost,
      highProfit: high === null ? null : high - line.landedUnitCost,
      lowMarginPct: low === null || !line.landedUnitCost ? null : (low - line.landedUnitCost) / line.landedUnitCost,
      highMarginPct: high === null || !line.landedUnitCost ? null : (high - line.landedUnitCost) / line.landedUnitCost,
    };
  });
}

/**
 * Run a full project costing.
 *
 * @param {object} input
 * @param {'per_sqft'|'per_tile'} input.mode         Which workbook's logic to use.
 * @param {object} input.area                        { squareFeet } or { squareInches }.
 * @param {object} input.rates                       FX, tariff, commission, tax.
 * @param {string[]} [input.formats]                 Formats to quote. Defaults to all four.
 * @param {object} [input.formatOverrides]           Per-format GBP price or tile count overrides.
 * @param {object[]} [input.specialty]               [{ id, quantity }].
 * @param {string} [input.selectedFormat]            The format the invoice is written against.
 * @param {object} [input.donorPricing]              { formatId: { low, high } }.
 */
export function calculate(input = {}) {
  const mode = input.mode === 'per_tile' ? 'per_tile' : 'per_sqft';
  const area = resolveArea(input.area);
  const rates = resolveRates(input.rates);
  const ctx = { area, rates, mode, overrides: input.formatOverrides ?? {} };

  const wanted = Array.isArray(input.formats) && input.formats.length ? input.formats : TILE_FORMATS.map((f) => f.id);
  const formats = wanted
    .map((id) => TILE_FORMAT_BY_ID.get(id))
    .filter(Boolean)
    .map((f) => costFormat(f, ctx));

  const specialtyInput = Array.isArray(input.specialty)
    ? input.specialty
    : SPECIALTY_ITEMS.map((s) => ({ id: s.id, quantity: 0 }));
  const specialty = specialtyInput.map((entry) => costSpecialty(entry, ctx));

  const addOns = resolveAddOns(input, rates);
  const addOnsSubtotal = addOns.reduce((sum, a) => sum + a.amount, 0);

  // Each format gets a standalone project total, so the four columns of the
  // workbook can be compared side by side.
  const withProjectTotals = formats.map((line) => {
    const salesTax = line.total * rates.taxRate;
    return {
      ...line,
      salesTax,
      addOnsTotal: addOnsSubtotal + salesTax,
      projectCost: line.total + addOnsSubtotal + salesTax,
    };
  });

  // The invoice is written against one chosen format plus any specialty pieces.
  const selectedId = input.selectedFormat && wanted.includes(input.selectedFormat) ? input.selectedFormat : wanted[0];
  const selected = withProjectTotals.find((f) => f.id === selectedId) ?? null;

  const billedSpecialty = specialty.filter((s) => s.quantity > 0);
  const specialtySubtotal = billedSpecialty.reduce((sum, s) => sum + s.total, 0);

  const tileSubtotal = selected ? selected.total : 0;
  const subtotal = tileSubtotal + specialtySubtotal;
  const salesTax = subtotal * rates.taxRate;
  const grandTotal = subtotal + addOnsSubtotal + salesTax;

  return {
    mode,
    area,
    rates,
    basis: {
      bpPerSquareMetre: rates.bpPerSquareMetre,
      bpPerSquareFoot: rates.bpPerSquareFoot,
      usdPerSquareFoot: rates.bpPerSquareFoot * rates.fxRate,
      fxRate: rates.fxRate,
      markupMultiplier: markupMultiplier(rates),
    },
    formats: withProjectTotals,
    specialty,
    addOns,
    addOnsSubtotal,
    pricingSheet: buildPricingSheet([...formats, ...specialty], input.donorPricing),
    totals: {
      selectedFormat: selectedId ?? null,
      tileSubtotal,
      specialtySubtotal,
      subtotal,
      salesTax,
      taxLabel: rates.taxLabel,
      taxRate: rates.taxRate,
      addOnsSubtotal,
      grandTotal,
      depositDue: grandTotal * rates.depositRate,
      balanceDue: grandTotal * (1 - rates.depositRate),
    },
  };
}
