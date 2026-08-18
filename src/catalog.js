/**
 * 360 Studio Wild — product catalogue and default pricing constants.
 *
 * Every value here is taken directly from the source workbooks:
 *   - 260805_Per_Square_Foot_Cost__Salvatore_Console.xlsx   (per-square-foot mode)
 *   - 260811_Meals_on_Wheels_Donor_Wall_PRELIMINARY_COST_.xlsx (per-tile mode)
 *
 * They are defaults only — every one of them is overridable from the UI or the
 * API payload, so pricing can move without a code change.
 */

/** Square feet in one square metre, used to convert a £/m2 base price. */
export const SQFT_PER_SQM = 10.763910416709722;

/** Square inches in one square foot. */
export const SQIN_PER_SQFT = 144;

/**
 * Tile formats. `side` drives the tile count (sq inches / side^2); `perSqFt` is
 * the workbook's "Total tiles per 1 sq ft" figure, which is what the per-square-
 * foot mode divides the base price by.
 *
 * Note the workbooks use perSqFt = 2.25 for the 8x8 (144/64 = 2.25) and 9 / 4 / 1
 * for the others, so the two routes agree exactly.
 */
export const TILE_FORMATS = [
  { id: '4x4',   label: '4x4 Inch Tiles',   side: 4,  perSqFt: 9,    ukCostPerTile: 3.0 },
  { id: '6x6',   label: '6x6 Inch Tiles',   side: 6,  perSqFt: 4,    ukCostPerTile: 6.13 },
  { id: '8x8',   label: '8x8 Inch Tiles',   side: 8,  perSqFt: 2.25, ukCostPerTile: 10.0 },
  { id: '12x12', label: '12x12 Inch Tiles', side: 12, perSqFt: 1,    ukCostPerTile: 23.23 },
];

/**
 * Non-tile pieces. These are priced per piece in both workbooks (they have no
 * square-foot equivalent), so they are always quoted from `ukCostPerUnit`.
 */
export const SPECIALTY_ITEMS = [
  { id: 'salad_plate',  label: 'Salad Plate',  ukCostPerUnit: 12.35 },
  { id: 'dinner_plate', label: 'Dinner Plate', ukCostPerUnit: 15.3 },
  { id: 'platter',      label: 'Platter',      ukCostPerUnit: 29.0 },
];

/**
 * Suggested donor prices from the Meals on Wheels "Client Pricing Sheet".
 * These are the prices a non-profit charges a donor per tile; the studio's
 * landed cost is what the engine computes.
 */
export const DEFAULT_DONOR_PRICING = {
  '4x4':         { low: 10,  high: 20 },
  '6x6':         { low: 25,  high: 30 },
  '8x8':         { low: 35,  high: 45 },
  '12x12':       { low: 50,  high: 65 },
  salad_plate:   { low: 45,  high: 60 },
  dinner_plate:  { low: 55,  high: 75 },
  platter:       { low: 100, high: 140 },
};

/** Default pricing constants, matching both workbooks. */
export const DEFAULTS = {
  bpPerSquareMetre: 61,     // £61/m2 base price
  bpPerSquareFoot: 5.67,    // £5.67/sq ft as entered in the Salvatore workbook
  fxRate: 1.35,             // GBP -> USD
  tariffRate: 0.1,          // 10%
  commissionRate: 0.4,      // 40%
  taxRate: 0.08625,         // California 94110 at 8.625%
  taxLabel: 'California 94110',
  shippingSamples: 50,
  shippingCompleted: 0,
  studioTime: 85,
  depositRate: 0.5,         // 50% due on invoice, per the proforma terms
};

/** Studio details as they appear on the proforma. */
export const BUSINESS = {
  name: '360 Studio Wild, LLC',
  tagline: 'Creating Signature Moments',
  productLine: 'Digital Ceramics Custom Tiles',
  address: {
    line1: '1329 Wexford Lane - Studio 360',
    city: 'Cincinnati',
    state: 'OH',
    postalCode: '45233',
    country: 'US',
  },
  phone: '(513) 484-1337',
  terms:
    'Make all checks payable to 360 Studio Wild, LLC; 50% due on invoice. ' +
    'Remaining due during shipping. Bespoke projects are non-refundable, by making ' +
    'a payment you are accepting our terms and conditions which can be found on our website.',
};

export const TILE_FORMAT_BY_ID = new Map(TILE_FORMATS.map((f) => [f.id, f]));
export const SPECIALTY_BY_ID = new Map(SPECIALTY_ITEMS.map((s) => [s.id, s]));
