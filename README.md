# 360 Studio Wild — Tile Project Calculator

Prices a custom tile project, produces an invoice in the studio's proforma
layout, and creates that invoice in GoHighLevel.

The inputs and outputs are taken from the two working spreadsheets:

- `260805_Per_Square_Foot_Cost__Salvatore_Console.xlsx` — per-square-foot pricing
- `260811_Meals_on_Wheels_Donor_Wall_PRELIMINARY_COST_.xlsx` — per-tile pricing
  and the client-facing donor pricing sheet

and the invoice layout from `proforma_standard_1.pdf`.

## Running it

```bash
npm start           # http://localhost:3000
npm test            # verifies the engine against both spreadsheets
```

No dependencies and no build step — Node 18 or newer is all that is needed.
GoHighLevel is optional: without credentials the app runs in full and an invoice
push returns the payload it *would* have sent, so you can inspect it first.

To connect GoHighLevel, copy `.env.example` to `.env` and fill in
`GHL_API_TOKEN` and `GHL_LOCATION_ID`.

## The two pricing modes

Both spreadsheets use the same cost stack but start from a different place, and
the calculator does both.

**Per square foot** (the Salvatore console job). One base price per square foot
— £5.67, itself £61/m² — is divided by how many of a given tile fill a square
foot. A 4x4 works out at £5.67 ÷ 9 = £0.63. Because the price follows the area,
every format costs the same for the same wall, which is why the four columns of
that workbook are identical.

**Per tile** (the Meals on Wheels donor wall). Each format carries its own
quoted price — £3.00 for a 4x4, £23.23 for a 12x12 — so the format you choose
changes the total. That sheet notes this explicitly: *"Calculations based upon
Per Tile cost rather than Per Sq Ft cost"*.

From there both modes are identical:

```
tiles needed   = project square inches ÷ (tile side)²
US cost/tile   = GBP cost/tile × FX rate (1.35)
tile cost      = tiles × US cost/tile
               + tariff      (10% of tile cost)
               + commission  (40% of tile cost)
= total tile cost
               + sales tax   (8.625%, on the tile subtotal only)
               + studio time, shipping and any other fixed add-ons
= project cost
```

Sales tax is charged on goods only, never on shipping or studio time — that is
how both the workbooks and the proforma do it.

### Whole tiles

The workbooks keep fractional tile counts (the donor wall needs 2,142.78 6x6
tiles), and the calculator reproduces that so the figures tie back. The invoice
bills 2,143, because a wall needs whole tiles. Untick *Invoice whole tiles* to
bill the fractional count instead.

## Donor pricing

The client pricing sheet shows what each piece costs landed — the US price with
tariff and commission on it — against what a donor is asked to pay, and the
margin between them. Any row where the suggested price clears cost by less than
15% is flagged.

## Two things to check in the source spreadsheets

The calculator follows the calculation tab in both cases. Both are pinned down
by tests in `test/calculator.test.js` so the choice stays visible.

**The 12x12 donor price does not cover its cost.** This one is worth a look
before the next donor wall goes out. The calculation tab quotes £23.23 for a
12x12 (cell I11), which lands at £23.23 × 1.35 × 1.5 = **$47.04**. The Client
Pricing Sheet shows the cost as **$28.13** and a profit of $21.88 at the
suggested $50 donor price. Those two do not reconcile: $28.13 implies a tile
price of about £13.89, not £23.23. If £23.23 is right, the real margin at $50 is
**$2.96**, not $21.88 — and every other row on that sheet runs at 65–100%. Either
the £23.23 on the calculation tab is stale, or the donor price needs to go up.

**The platter cost cell is missing its markup.** Cell B10 reads $39.15, which is
£29 × 1.35 with no tariff or commission — unlike every other row on that sheet.
The correct landed cost is $58.73, and the sheet's own profit cells agree: E10's
$41.28 is 100 − 58.72, not 100 − 39.15. Only the displayed cost is off; the
margins are right.

## GoHighLevel

Pushing an invoice does three things:

1. **Upserts the client as a contact** (`POST /contacts/upsert`), matching on
   email or phone so re-invoicing the same client reuses their record.
2. **Creates the invoice** (`POST /invoices/`) against the configured location.
3. **Emails it**, if you used *Create & email to client* or set
   `GHL_AUTO_SEND=true`.

Tile formats and specialty pieces become invoice line items; studio time,
shipping and any flat VAT become fixed lines. Sales tax is handled one of two
ways: set `GHL_TAX_ID` to an existing GoHighLevel tax record and it is attached
to the goods lines so GoHighLevel calculates and reports the tax itself;
otherwise the tax is added as its own line item, which keeps the total correct
but does not classify it as tax in GoHighLevel's reporting.

Rate limits and 5xx responses are retried with backoff; a rejected payload is
not retried and GoHighLevel's own error message is passed straight through.

The payload mapping is covered by tests in `test/ghl.test.js` — most importantly
that the line items GoHighLevel receives add up to the invoice total, under both
tax arrangements and with a flat VAT line.

> What those tests cannot cover is the API itself. The request shapes follow the
> documented v2 API, but the docs were not reachable from the build environment
> and no live account was available, so nothing here has been exercised against
> the real GoHighLevel. Run one invoice with `GHL_LIVE_MODE=false` first and
> check it lands correctly before going live.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/catalog` | Formats, specialty pieces, default rates, GoHighLevel status |
| `POST /api/calculate` | Costing only |
| `POST /api/invoice` | Costing plus the invoice document and its text rendering |
| `POST /api/invoice/ghl` | Costing, invoice, and push to GoHighLevel |

```bash
curl -s localhost:3000/api/invoice -H 'Content-Type: application/json' -d '{
  "calculation": {
    "mode": "per_tile",
    "area": { "squareInches": 77140 },
    "selectedFormat": "6x6",
    "rates": { "taxRate": 8.625, "taxLabel": "California 94110" },
    "studioTime": 85, "shippingSamples": 50
  },
  "invoice": {
    "invoiceNumber": "4",
    "client": { "company": "Meals on Wheels", "email": "name@example.org" },
    "projectName": "Custom Designed Mural Tiles", "projectDetail": "Donor Wall"
  }
}' | jq -r .text
```

The browser recalculates as you type using the same engine, but the server
always recalculates from the raw inputs before creating an invoice — nothing the
browser computed is ever billed.

## Layout

```
src/catalog.js       Tile formats, specialty pieces, default rates, studio details
src/calculator.js    The costing engine — both modes, one cost stack
src/invoice.js       Invoice document and its plain-text proforma rendering
server/config.js     Environment configuration and a small .env loader
server/ghl.js        GoHighLevel client: contacts, invoices, send
server/index.js      HTTP server and JSON API
public/              Calculator UI
test/                Verification against both spreadsheets, and the GoHighLevel mapping
```

## Changing prices

Everything is editable in the UI for a one-off job. To change what the form
*starts* with — a new FX rate, a tile price rise, a different tax jurisdiction —
edit the constants in `src/catalog.js`; they are the only place those numbers
are defined.
