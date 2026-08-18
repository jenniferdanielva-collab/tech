/**
 * Every expected figure below is read straight out of the two source workbooks.
 * If the engine drifts from the spreadsheets, these fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, round } from '../src/calculator.js';

/** Money comparison to the nearest cent. */
const money = (actual, expected, label) =>
  assert.equal(round(actual, 2), round(expected, 2), label);

// Both workbooks carry the same two fixed add-ons and no completed-tile shipping.
const workbookAddOns = { studioTime: 85, shippingSamples: 50, shippingCompleted: 0 };

/* ------------------------------------------------------------------ *
 * Salvatore Console — per-square-foot mode
 * ------------------------------------------------------------------ */

const salvatore = (squareFeet) =>
  calculate({
    mode: 'per_sqft',
    area: { squareFeet },
    rates: { bpPerSquareFoot: 5.67, fxRate: 1.35, tariffRate: 0.1, commissionRate: 0.4, taxRate: 0.08625 },
    ...workbookAddOns,
  });

test('Salvatore: per-square-foot basis matches sheet F5/F6', () => {
  const r = salvatore(250);
  money(r.basis.bpPerSquareFoot, 5.67, 'BP/sq ft');
  money(r.basis.usdPerSquareFoot, 7.6545, '$/sq ft (F6)');
  money(r.area.squareInches, 36000, 'project square inches (F9)');
});

test('Salvatore 250 sq ft: per-tile costs match row 12-15', () => {
  const by = Object.fromEntries(salvatore(250).formats.map((f) => [f.id, f]));

  // Column G: total tiles needed
  money(by['4x4'].tilesNeeded, 2250, '4x4 tiles');
  money(by['6x6'].tilesNeeded, 1000, '6x6 tiles');
  money(by['8x8'].tilesNeeded, 562.5, '8x8 tiles');
  money(by['12x12'].tilesNeeded, 250, '12x12 tiles');

  // Column I / J: UK and US cost per tile
  money(by['4x4'].ukCostPerTile, 0.63, '4x4 UK cost/tile');
  money(by['4x4'].usCostPerTile, 0.8505, '4x4 US cost/tile');
  money(by['12x12'].ukCostPerTile, 5.67, '12x12 UK cost/tile');
  money(by['12x12'].usCostPerTile, 7.6545, '12x12 US cost/tile');

  // In per-square-foot mode every format prices out identically (K19=L19=M19=N19).
  for (const f of Object.values(by)) money(f.baseCost, 1913.625, `${f.id} tile cost`);
});

test('Salvatore 250 sq ft: cost stack matches rows 19-30', () => {
  const f = salvatore(250).formats.find((x) => x.id === '4x4');
  money(f.baseCost, 1913.625, 'Total Tile Cost (K19)');
  money(f.tariff, 191.3625, 'Tariff 10% (K20)');
  money(f.commission, 765.45, 'Commission 40% (K21)');
  money(f.total, 2870.4375, 'Total Tile Cost (K22)');
  money(f.salesTax, 247.575234375, 'California 8.625% (K25)');
  money(f.addOnsTotal, 382.575234375, 'Total Add ons (K29)');
  money(f.projectCost, 3253.012734375, 'Project Costs (K30)');
});

test('Salvatore 230 sq ft sheet reproduces', () => {
  const f = salvatore(230).formats.find((x) => x.id === '4x4');
  money(f.tilesNeeded, 2070, 'tiles (G12)');
  money(f.baseCost, 1760.535, 'Tile Cost (K16)');
  money(f.total, 2640.8025, 'Total Tile Cost (K19)');
  money(f.salesTax, 227.769215625, 'VAT (K22)');
  money(f.projectCost, 3003.571715625, 'Project Costs (K27)');
});

test('Salvatore 350 sq ft sheet reproduces', () => {
  const f = salvatore(350).formats.find((x) => x.id === '4x4');
  money(f.tilesNeeded, 3150, 'tiles (G12)');
  money(f.baseCost, 2679.075, 'Tile Cost (K16)');
  money(f.total, 4018.6125, 'Total Tile Cost (K19)');
  money(f.salesTax, 346.605328125, 'VAT (K22)');
  money(f.projectCost, 4500.217828125, 'Project Costs (K27)');
});

test('Salvatore specialty pieces price at the workbook rates (J16-J18)', () => {
  const r = calculate({
    mode: 'per_sqft',
    area: { squareFeet: 250 },
    rates: { bpPerSquareFoot: 5.67, fxRate: 1.35 },
    specialty: [
      { id: 'salad_plate', quantity: 1 },
      { id: 'dinner_plate', quantity: 1 },
      { id: 'platter', quantity: 1 },
    ],
  });
  const by = Object.fromEntries(r.specialty.map((s) => [s.id, s]));
  money(by.salad_plate.usCostPerTile, 16.6725, 'salad plate US cost');
  money(by.dinner_plate.usCostPerTile, 20.655, 'dinner plate US cost');
  money(by.platter.usCostPerTile, 39.15, 'platter US cost');
});

/* ------------------------------------------------------------------ *
 * Meals on Wheels donor wall — per-tile mode
 * ------------------------------------------------------------------ */

const donorWall = () =>
  calculate({
    mode: 'per_tile',
    area: { squareInches: 77140 },
    rates: { fxRate: 1.35, tariffRate: 0.1, commissionRate: 0.4, taxRate: 0.08625 },
    specialty: [
      { id: 'salad_plate', quantity: 1 },
      { id: 'dinner_plate', quantity: 1 },
      { id: 'platter', quantity: 1 },
    ],
    ...workbookAddOns,
  });

test('Donor wall: tile counts match row 8-11 column G', () => {
  const by = Object.fromEntries(donorWall().formats.map((f) => [f.id, f]));
  money(by['4x4'].tilesNeeded, 4821.25, '4x4 (G8)');
  money(by['6x6'].tilesNeeded, 2142.777777777778, '6x6 (G9)');
  money(by['8x8'].tilesNeeded, 1205.3125, '8x8 (G10)');
  money(by['12x12'].tilesNeeded, 535.6944444444445, '12x12 (G11)');
});

test('Donor wall: project cost per format matches row 15', () => {
  const by = Object.fromEntries(donorWall().formats.map((f) => [f.id, f]));
  money(by['4x4'].baseCost, 19526.0625, '4x4 (K15)');
  money(by['6x6'].baseCost, 17732.5575, '6x6 (L15)');
  money(by['8x8'].baseCost, 16271.71875, '8x8 (M15)');
  money(by['12x12'].baseCost, 16799.645625, '12x12 (N15)');
});

test('Donor wall: 4x4 column reproduces rows 16-30', () => {
  const f = donorWall().formats.find((x) => x.id === '4x4');
  money(f.tariff, 1952.60625, 'Tariff (K16)');
  money(f.commission, 7810.425, 'Commission (K17)');
  money(f.total, 29289.09375, 'Total Tile Cost (K18)');
  money(f.salesTax, 2526.1843359375, 'VAT (K25)');
  money(f.addOnsTotal, 2661.1843359375, 'Total Add ons (K29)');
  money(f.projectCost, 31950.278085937, 'Project Costs (K30)');
});

test('Donor wall: 6x6 and 8x8 project costs match L30 and M30', () => {
  const by = Object.fromEntries(donorWall().formats.map((f) => [f.id, f]));
  money(by['6x6'].projectCost, 29027.985876562503, 'L30');
  money(by['8x8'].projectCost, 26647.73173828125, 'M30');
});

test('Donor wall: specialty totals match rows 15-22 columns O-Q', () => {
  const by = Object.fromEntries(donorWall().specialty.map((s) => [s.id, s]));
  money(by.salad_plate.total, 25.00875, 'salad plate (O18)');
  money(by.dinner_plate.total, 30.9825, 'dinner plate (P18)');
  money(by.platter.total, 58.725, 'platter (Q18)');

  // Rows 21/22: donor price less landed cost.
  const sheet = Object.fromEntries(donorWall().pricingSheet.map((p) => [p.id, p]));
  money(sheet.salad_plate.lowProfit, 19.99125, 'LOW MOW profit (O21)');
  money(sheet.dinner_plate.lowProfit, 24.0175, 'LOW MOW profit (P21)');
  // Q22 lands exactly on a half-cent (81.275); compare at 3dp rather than
  // arguing with the rounding direction.
  assert.equal(round(sheet.platter.highProfit, 3), 81.275, 'HIGH MOW profit (Q22)');
});

test('Client Pricing Sheet unit costs and profits reproduce', () => {
  const sheet = Object.fromEntries(donorWall().pricingSheet.map((p) => [p.id, p]));

  // Column B: landed cost per piece = US cost/tile x (1 + tariff + commission).
  money(sheet['4x4'].unitCost, 6.08, '4x4 tile cost (B4)');
  money(sheet['6x6'].unitCost, 12.41, '6x6 tile cost (B5)');
  money(sheet['8x8'].unitCost, 20.25, '8x8 tile cost (B6)');
  money(sheet.salad_plate.unitCost, 25.01, 'salad plate (B8)');
  money(sheet.dinner_plate.unitCost, 30.98, 'dinner plate (B9)');

  // Columns E/F: donor price less cost.
  money(sheet['4x4'].lowProfit, 3.93, '4x4 low profit (E4)');
  money(sheet['4x4'].highProfit, 13.93, '4x4 high profit (F4)');
  money(sheet['6x6'].lowProfit, 12.59, '6x6 low profit (E5)');
  money(sheet['8x8'].highProfit, 24.75, '8x8 high profit (F6)');
  money(sheet.platter.lowProfit, 41.28, 'platter low profit (E10)');
});

/* ------------------------------------------------------------------ *
 * Known inconsistencies in the source workbook.
 *
 * These two rows of the "Client Pricing Sheet" tab do not agree with the
 * calculation tab. The engine follows the calculation tab, and these tests pin
 * that decision down so it is a choice rather than an accident.
 * ------------------------------------------------------------------ */

test('workbook quirk: the platter cost cell omits the markup, its profit cells do not', () => {
  const sheet = Object.fromEntries(donorWall().pricingSheet.map((p) => [p.id, p]));

  // Cell B10 reads 39.15, which is 29.00 x 1.35 with no tariff or commission
  // applied -- unlike every other row on that sheet. The engine marks it up.
  money(sheet.platter.unitCost, 58.725, 'platter landed cost, marked up like every other row');

  // The workbook's own profit cells agree with the engine, not with B10:
  // E10 = 100 - 58.72 = 41.28 and F10 = 140 - 58.72 = 81.28.
  money(sheet.platter.lowProfit, 41.28, 'E10 was computed from 58.72, not 39.15');
  assert.equal(round(sheet.platter.highProfit, 3), 81.275, 'F10 likewise');
});

test('workbook quirk: the 12x12 client price is built on a lower tile cost than the calc tab', () => {
  const sheet = Object.fromEntries(donorWall().pricingSheet.map((p) => [p.id, p]));

  // The calculation tab quotes GBP 23.23 for a 12x12 (cell I11), which lands at
  // 23.23 x 1.35 x 1.5 = 47.04. The Client Pricing Sheet shows 28.13 (B7) and a
  // profit of 21.88 (E7), which implies a tile price of GBP 13.89 instead.
  money(sheet['12x12'].unitCost, 47.04, 'landed cost at the calc tab price of GBP 23.23');

  // Consequence: at GBP 23.23 the suggested donor price of 50 leaves 2.96, not
  // the 21.88 the pricing sheet advertises.
  money(sheet['12x12'].donorLow, 50, 'suggested low donor price');
  money(sheet['12x12'].lowProfit, 2.96, 'actual margin at the calc tab price');
});

/* ------------------------------------------------------------------ *
 * Behaviour beyond the workbooks
 * ------------------------------------------------------------------ */

test('square inches given directly override square feet', () => {
  const r = calculate({ area: { squareFeet: 100, squareInches: 77140 } });
  money(r.area.squareInches, 77140, 'square inches win');
  assert.equal(r.area.source, 'square_inches');
});

test('rates accept percentages as well as fractions', () => {
  const asPct = calculate({ area: { squareFeet: 250 }, rates: { tariffRate: 10, commissionRate: 40, taxRate: 8.625 } });
  const asFraction = calculate({ area: { squareFeet: 250 }, rates: { tariffRate: 0.1, commissionRate: 0.4, taxRate: 0.08625 } });
  money(asPct.totals.grandTotal, asFraction.totals.grandTotal, 'same result either way');
});

test('deriving BP/sq ft from BP/m2 converts correctly', () => {
  const r = calculate({ area: { squareFeet: 250 }, rates: { bpPerSquareMetre: 61, deriveFromSquareMetre: true } });
  money(r.basis.bpPerSquareFoot, 5.67, '61/m2 is 5.67/sq ft');
});

test('tiles to order rounds up from the fractional count', () => {
  const f = calculate({ mode: 'per_tile', area: { squareInches: 77140 } }).formats.find((x) => x.id === '6x6');
  money(f.tilesNeeded, 2142.777777777778, 'fractional count kept for pricing');
  assert.equal(f.tilesToOrder, 2143, 'whole tiles to order');
});

test('invoice totals combine the selected format, specialty pieces and add-ons', () => {
  const r = calculate({
    mode: 'per_tile',
    area: { squareInches: 77140 },
    selectedFormat: '6x6',
    specialty: [{ id: 'platter', quantity: 2 }],
    rates: { taxRate: 0.08625 },
    ...workbookAddOns,
  });
  money(r.totals.tileSubtotal, 26598.83625, 'selected format total');
  money(r.totals.specialtySubtotal, 117.45, '2 platters');
  money(r.totals.subtotal, 26716.28625, 'subtotal');
  money(r.totals.salesTax, 26716.28625 * 0.08625, 'tax on subtotal only');
  money(r.totals.grandTotal, 26716.28625 + 135 + 26716.28625 * 0.08625, 'grand total');
  money(r.totals.depositDue, r.totals.grandTotal / 2, '50% deposit');
});
