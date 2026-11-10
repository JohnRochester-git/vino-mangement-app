# Vino API

This is the reference for the backend API: every endpoint, what to send, what comes back, and what can go wrong. It's written for whoever connects the frontend to the backend.

- [The basics](#the-basics)
- [Errors](#errors)
- [Auth](#auth)
- [Collections and household](#collections-and-household)
- [Wine catalog](#wine-catalog)
- [Bottles (inventory items)](#bottles-inventory-items)
- [Drinking and the journal](#drinking-and-the-journal)
- [Value](#value)
- [Insights and reference data](#insights-and-reference-data)
- [CSV export and import](#csv-export-and-import)
- [Wishlist](#wishlist)
- [Replacing localStorage](#replacing-localstorage)

## The basics

**Base URL.** Every endpoint starts with `/api/v1`. Locally that's `http://localhost:8000/api/v1` (start the backend with `scripts/start.py`). On the live site it's `/api/v1` on the same domain as the pages.

**Logging in uses a cookie.** Signing up or logging in sets a cookie named `vino_session`. The browser sends it back by itself. JavaScript can't read it (it's `HttpOnly`), which protects it from theft. A login lasts 14 days unless you log out.

**Always send JSON.** Every request that changes something (`POST`, `PATCH`, `DELETE`) must have the header `Content-Type: application/json`, even if it has no body (logout, deletes). Anything else gets `415`. This blocks other websites from sending forged requests. The one exception is [CSV import](#post-collectionsidimport), which sends a file.

**Local development from a different port.** If the pages are served from `http://localhost:5500` (for example with `python -m http.server 5500`) while the API runs on port 8000, add `credentials: "include"` to every `fetch`, or the cookie won't be sent. Ports 5500 on `localhost` and `127.0.0.1` are allowed by default. Others go in the `ALLOWED_ORIGINS` setting.

A small helper that does all of this:

```js
const API = "http://localhost:8000/api/v1"; // on the live site: "/api/v1"

async function api(method, path, body) {
  const resp = await fetch(API + path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw { status: resp.status, ...(data && data.error) };
  return data;
}

// Examples:
// const me = await api("GET", "/auth/me");
// await api("POST", "/items/7/consume", { quantity: 1, rating: 4.5 });
```

**Field names** match the team's data dictionary (`wineName`, `wineVint`, `itemQuantity`, `itemAquiredDate`...). A few request fields named in the build brief use short names instead: `wineId` and `wine` when adding a bottle, `quantity`/`notes`/`rating`/`consumedAt` when drinking, and `password`.

**Money.**

- **You send dollars:** a number or text, like `24.99`, `"24.99"`, or `"$1,150"`. At most 2 decimal places, from 0 to 10,000,000.
- **You get back two fields for every amount:**
  - `...Cents` is a whole number of cents, for maths and sorting. `115000` means $1,150.00.
  - `...Formatted` is ready to show, like `"$1,150.00"`.
  - Both are `null` when there's no value. **`null` means "not valued", not $0.** Show it as "Not valued" or "—".

**Dates.** Send dates as `YYYY-MM-DD`. Timestamps come back in UTC, like `2026-10-29T19:30:00Z`.

**Not found means not yours.** Asking for a collection, bottle, or journal entry that isn't in one of your collections returns `404`, exactly as if it didn't exist. That way nobody can discover other households' data.

## Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Some fields need attention.",
    "fields": {
      "wineVint": "Vintage must be between 1800 and 2027.",
      "itemQuantity": "Quantity must be between 1 and 9,999."
    }
  }
}
```

`fields` only appears on validation errors. It has one plain-English message per field, ready to show next to that input. Field names inside a nested new wine are prefixed: `wine.wineVint`.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `validation_error` | A field is missing, wrong, or unknown. See `fields`. |
| 400 | `bad_request` | The body isn't a JSON object. |
| 401 | `not_authenticated` | Not logged in, or the login expired. Send the user to the login page. |
| 401 | `invalid_credentials` | Wrong email or password at login. The message is the same for both. |
| 403 | `forbidden` | A household member tried an owner-only action. |
| 404 | `not_found` (or `user_not_found`) | Doesn't exist, or isn't yours. |
| 405 | `method_not_allowed` | Wrong HTTP method for that path. |
| 409 | various (below) | Conflicts with existing data. |
| 413 | `too_large` | Request body over 2 MB. |
| 415 | `unsupported_media_type` | Missing `Content-Type: application/json`. |
| 429 | `too_many_attempts` | Login locked for 5 minutes after 5 failures. |
| 500 | `internal_error` | A bug. The details are logged on the server, never sent to the browser. |
| 503 | `service_unavailable` | The database couldn't be reached. Ask the user to try again shortly. |

400 `import_errors` is the CSV import's error. It lists problems by row instead of `fields`; see [CSV import](#post-collectionsidimport).

409 codes: `email_taken`, `already_member`, `owner_cannot_leave`, `barcode_exists`, `wine_not_editable`, `wine_in_use`, `not_enough_bottles`, `conflict`.

### Validation rules

| What | Rule |
| --- | --- |
| Email | Valid format, at most 254 characters. Stored lowercase. |
| Password | At least 8 characters (at most 200). |
| First and last name | 1 to 50 characters. |
| Wine name | 1 to 120 characters. |
| Producer, region, storage location | At most 120 characters. |
| Description, profile, notes | At most 2,000 characters. |
| `wineType` | Red, White, Rosé, Sparkling, Dessert, Fortified, or Orange. Upper/lower case doesn't matter, and `Rose` is accepted for Rosé. |
| `wineVint` | Empty (non-vintage), or 1800 to next year. |
| Quantities | Whole numbers, 1 to 9,999. Editing a bottle may set 0. |
| Money | See [money](#the-basics). |
| Dates | `YYYY-MM-DD`. `itemDrinkFrom` on or before `itemDrinkBy`. Acquired date and drinking time can't be in the future. |
| Barcode | Text (not a number, so leading zeros survive). Digits only, 8, 12, 13 or 14 long, with a valid check digit. |
| Rating | 1 to 5 in half steps: 1, 1.5, 2 ... 5. |
| Unknown fields | Rejected, with "Unknown field '...'". This catches typos. |

All text is trimmed, and invisible control characters are removed. Sending `null` or `""` for an optional field clears it.

## Auth

### POST /auth/signup

Creates an account, a collection called "My Cellar" with the new user as owner, and logs them in.

```json
{"userEmail": "frank@example.com", "password": "correct horse", "userFname": "Frank", "userLname": "Delgado"}
```

`201`:

```json
{
  "user": {
    "userID": 1,
    "userEmail": "frank@example.com",
    "userFname": "Frank",
    "userLname": "Delgado",
    "userFullname": "Frank Delgado",
    "userCreatedAt": "2026-10-29T21:10:36Z"
  },
  "collections": [
    {
      "collectionId": 1,
      "collectionName": "My Cellar",
      "userID": 1,
      "memberRole": "owner",
      "bottleCount": 0,
      "collectionSumValueCents": 0,
      "collectionSumValueFormatted": "$0.00"
    }
  ]
}
```

Errors: `400` validation, `409 email_taken`.

### POST /auth/login

```json
{"userEmail": "frank@example.com", "password": "correct horse"}
```

`200`: the same shape as signup. Errors: `400`, `401 invalid_credentials` ("That email and password don't match an account."), `429 too_many_attempts`.

Login is by email only. The current prototype also allows logging in by display name; the API doesn't.

**Lockout tradeoff.** After 5 failed logins for one email within 15 minutes, that email can't log in for 5 minutes, even with the right password. This slows down password guessing. The downside is that anyone who knows someone's email can lock them out for 5 minutes by typing wrong passwords. The lockout is kept short for that reason. A successful login resets the count.

### POST /auth/logout

No body, but still send `Content-Type: application/json`. `200`: `{"loggedOut": true}`. The session is deleted on the server, so the old cookie stops working everywhere.

### GET /auth/me

`200`: the same shape as signup (the user plus their collections). `401` if not logged in. Call this when a page loads to find out who's logged in.

## Collections and household

A collection is a cellar. A household shares one: the owner adds other people by email, and everyone sees and edits the same bottles. Only the owner can delete the collection or change who's in it.

### GET /collections

`200`: `{"collections": [ ...collection objects as in signup... ]}`. Every collection you own or are a member of. `memberRole` tells you which. `collectionSumValueCents` is the total value of the bottles left (valued bottles only).

### POST /collections

```json
{"collectionName": "Beach House"}
```

`201`: the collection. Its creator is the owner. Errors: `400` (name 1 to 80 characters).

### GET /collections/{id}

`200`: the collection. `404` if you're not a member.

### PATCH /collections/{id}

`{"collectionName": "Delgado Cellar"}`. Any member can rename. `200`: the collection.

### DELETE /collections/{id}

Owner only. Deletes the collection, all its bottles, journal entries and memberships. `200`: `{"deleted": true}`. Errors: `403` (member), `404`.

### GET /collections/{id}/members

```json
{
  "members": [
    {"userID": 1, "userEmail": "frank@example.com", "userFullname": "Frank Delgado", "memberRole": "owner", "memberAddedAt": "2026-10-29T21:10:36Z"},
    {"userID": 2, "userEmail": "maria@example.com", "userFullname": "Maria Delgado", "memberRole": "member", "memberAddedAt": "2026-10-29T21:12:02Z"}
  ]
}
```

### POST /collections/{id}/members

Owner only. The person must already have an account.

```json
{"userEmail": "maria@example.com"}
```

`201`: the new member. Errors: `403`, `404 user_not_found` ("No account uses that email. Ask them to sign up first."), `409 already_member`.

### DELETE /collections/{id}/members/{userId}

Owner only. `200`: `{"deleted": true}`. Errors: `403`, `404`, `409 owner_cannot_leave` (the owner can't remove themselves).

## Wine catalog

Wines are shared by everyone: one entry per wine and vintage. When a household adds a wine with a barcode, everyone's next scan of that barcode finds it.

To protect other households, **only the person who added a wine can edit it, and only while no other household has it in their cellar.** A household's own value goes on its bottle instead (see [Value](#value)).

A wine object:

```json
{
  "wineID": 1,
  "wineName": "Château Margaux",
  "wineProducer": null,
  "wineRegion": "Margaux, Bordeaux, France",
  "wineType": "Red",
  "wineVint": 2010,
  "wineDescription": null,
  "wineProfile": null,
  "blendID": 11,
  "blendStyle": "Bordeaux Blend",
  "wineBarcode": "0089744000026",
  "wineImageKey": null,
  "wineValueCents": 115000,
  "wineValueFormatted": "$1,150.00",
  "wineCreatedAt": "2026-10-29T21:10:36Z",
  "wineCreatedByUserID": 1,
  "pairings": ["Beef", "Lamb"]
}
```

### GET /wines?search=

Searches name, producer and region. Returns up to 50: `{"wines": [ ...wine objects... ]}`. Without `search`, it returns the first 50 by name.

### GET /wines/{id}

`200`: the wine. `404` if it doesn't exist.

### POST /wines

Adds a wine to the catalog without adding a bottle. Usually you'll add a bottle with a nested new wine instead (see [POST /collections/{id}/items](#post-collectionsiditems)).

```json
{
  "wineName": "Château Margaux",
  "wineType": "Red",
  "wineVint": 2010,
  "wineProducer": "Château Margaux",
  "wineRegion": "Margaux, Bordeaux, France",
  "wineDescription": "Silky tannins, crushed violets, blackcurrant.",
  "wineProfile": "Great with grilled ribeye.",
  "wineValue": 1150,
  "blendID": 11,
  "wineBarcode": "089744000026",
  "pairings": ["Beef", "Lamb"]
}
```

Only `wineName` and `wineType` are required. `blendID` comes from [GET /blends](#get-blends). `pairings` are names from [GET /pairings](#get-pairings). `wineImageKey` is an optional R2 object key (letters, digits, `/ _ - .`). `201`: the wine.

Errors: `400`, `409 barcode_exists` (the message says which wine already has that barcode, so you can use its `wineId`).

### PATCH /wines/{id}

Same fields as POST, all optional. `pairings` replaces the whole list. Changing `wineValue` adds a value history entry.

Errors: `400`, `404`, `409 wine_not_editable` (you didn't add this wine), `409 wine_in_use` (another household has it), `409 barcode_exists`.

### GET /wines/barcode/{code}

The scan step of Epic 1. Checks the catalog first, then the outside barcode service if one is turned on (see [Barcode lookup](#barcode-lookup)).

Found in the catalog. Add the bottle with `wineId`:

```json
{"found": true, "source": "catalog", "wine": { ...wine object... }}
```

Found by the outside service. **Not saved yet.** Show the details in the add-bottle form for the user to confirm or fix, then add the bottle with a nested `wine` (including `wineBarcode`). That saves it, so the next scan finds it in the catalog. Fields the service didn't know are `null`. `wineType` is often missing and must be filled in.

```json
{
  "found": true,
  "source": "provider",
  "provider": "openfoodfacts",
  "wine": {"wineID": null, "wineName": "Josh Cellars Cabernet Sauvignon 2020", "wineProducer": "Josh Cellars",
           "wineRegion": null, "wineType": "Red", "wineVint": 2020, "wineBarcode": "0089744000026"}
}
```

Not found anywhere. This is normal, not an error: switch to manual entry.

```json
{"found": false}
```

Errors: `400` if the code isn't a valid barcode (wrong length, letters, bad check digit). The field name in `fields` is `code`.

#### Barcode lookup

Set by the `BARCODE_PROVIDER` setting:

- `none` (default): only wines already in the catalog are found.
- `openfoodfacts`: also asks [Open Food Facts](https://world.openfoodfacts.org), a free, volunteer-run product database that includes some wines. No API key is needed. Set `BARCODE_CONTACT` to a team email: its terms ask every app to identify itself with a contact address. Limits and terms, from its API docs (checked 2026-10-29):
  - 15 product lookups per minute per IP address. Going over can get the IP banned. All container instances may share one IP.
  - The data is under the Open Database License (ODbL), and product images under CC BY-SA.
  - The data comes with no guarantee of accuracy, which is why the user always confirms.
  - General product databases often know little about wine. The backend only accepts results that Open Food Facts files under a wine category, and leaves out anything it can't tell.

Every outside lookup gives up after 3 seconds. Any failure (timeout, network error, odd response) returns `{"found": false}`, never an error.

### GET /wines/{id}/pairings

`200`: `{"pairings": [{"pairingID": 1, "pairingName": "Beef"}, ...]}`.

## Bottles (inventory items)

An item is a number of bottles of one wine in one collection, with where they're stored, when they were bought, what was paid, and when to drink them.

An item object (wine shortened):

```json
{
  "itemID": 1,
  "collectionId": 1,
  "wineID": 1,
  "itemQuantity": 2,
  "isLastBottle": false,
  "itemStoredAt": "Rack A, Row 3",
  "itemAquiredDate": "2024-05-01",
  "itemDrinkFrom": "2013-01-01",
  "itemDrinkBy": "2022-12-31",
  "itemDrinkWindowSource": "estimate",
  "drinkStatus": "pastPeak",
  "itemPurchasePriceCents": 90000,
  "itemPurchasePriceFormatted": "$900.00",
  "itemValueCents": null,
  "itemValueFormatted": null,
  "currentValueCents": 115000,
  "currentValueFormatted": "$1,150.00",
  "currentValueSource": "wine",
  "totalValueCents": 230000,
  "totalValueFormatted": "$2,300.00",
  "gainLossPerBottleCents": 25000,
  "gainLossPerBottleFormatted": "$250.00",
  "gainLossCents": 50000,
  "gainLossFormatted": "$500.00",
  "itemCreatedAt": "2026-10-29T21:10:36Z",
  "wine": { "wineID": 1, "wineName": "Château Margaux", "...": "..." }
}
```

What the calculated fields mean:

| Field | Meaning |
| --- | --- |
| `isLastBottle` | `true` when exactly one bottle is left. Warn before it's opened. |
| `drinkStatus` | `notSet` (no window), `tooYoung` (before `itemDrinkFrom`), `ready`, `drinkSoon` (within 180 days of `itemDrinkBy`, including that day), `pastPeak` (after `itemDrinkBy`). |
| `itemDrinkWindowSource` | `estimate`: worked out from type and vintage, so label it "estimated". `user`: entered by someone. `provider`: from an outside data source (none yet). |
| `currentValue...` | Value of one bottle now: the household's own `itemValue` if set, otherwise the catalog `wineValue`. `null` means not valued. |
| `currentValueSource` | `item`, `wine`, or `null`. |
| `totalValue...` | `currentValue` × bottles left. |
| `gainLoss...` | Value minus purchase price, per bottle and for all bottles left. `null` unless both are known. Negative is a loss. |

**Drinking-window estimates.** If you don't send a window, one is estimated from the wine's type and vintage, in years after the vintage: Sparkling 1–5, White 1–5, Rosé 0–2, Orange 1–5, Red 3–12, Dessert 5–25, Fortified 5–30. Non-vintage wines count from the acquired date, or today if that's not given. These are placeholder rules of thumb, kept in one table in `backend/vino/services/drink_window.py` so the team can tune them. A window someone typed in is never overwritten by an estimate.

### GET /collections/{id}/items

Query options, all optional:

| Option | Example | Meaning |
| --- | --- | --- |
| `type` | `type=Red` | One wine type. |
| `region` | `region=bordeaux` | Region contains this text. |
| `storedAt` | `storedAt=fridge` | Storage location contains this text. |
| `search` | `search=margaux` | Name, producer or region contains this text. |
| `drinkStatus` | `drinkStatus=drinkSoon` | One status. |
| `sort` | `sort=value` | `name` (default), `vintage`, `value`, `drinkBy`, or `acquired`. Bottles missing that value go last. |
| `order` | `order=desc` | `asc` (default) or `desc`. |
| `includeEmpty` | `includeEmpty=true` | Also show items with 0 bottles left (finished wines). Hidden by default. |
| `soonDays` | `soonDays=90` | How close to drink-by counts as `drinkSoon`. Default 180. |

`200`: `{"items": [ ...item objects... ], "count": 3}`. Errors: `400` for an unknown option or a bad value, `404`.

### POST /collections/{id}/items

Adds bottles. Send **either** `wineId` (a wine from the catalog or a scan) **or** `wine` (a new wine's details, the manual-entry path), not both.

From a scan or search:

```json
{"wineId": 1, "itemQuantity": 2, "itemAquiredDate": "2024-05-01", "itemPurchasePrice": 900, "itemStoredAt": "Rack A, Row 3"}
```

Manual entry, with an optional barcode and the user's own drinking window:

```json
{
  "itemQuantity": 3,
  "itemPurchasePrice": "17.99",
  "itemStoredAt": "Kitchen fridge",
  "itemDrinkFrom": "2025-01-01",
  "itemDrinkBy": "2030-12-31",
  "wine": {"wineName": "Marqués de Riscal Reserva", "wineType": "Red", "wineVint": 2018,
           "wineRegion": "Rioja, Spain", "wineValue": 17, "wineBarcode": "089744000026", "pairings": ["Lamb"]}
}
```

Only `itemQuantity` is required (1 to 9,999). If either drink date is sent, the window counts as the user's. `201`: the item.

Errors: `400` (field names inside `wine` are prefixed, like `wine.wineType`), `404`, `409 barcode_exists`.

### GET /items/{id}

`200`: the item. `404` if it isn't in one of your collections.

### PATCH /items/{id}

Any of `itemQuantity` (0 to 9,999, for corrections), `itemAquiredDate`, `itemPurchasePrice`, `itemStoredAt`, `itemDrinkFrom`, `itemDrinkBy`. `200`: the item.

- Changing either drink date makes the window the user's.
- Sending both drink dates as `null` goes back to an estimate.
- If the window is an estimate, changing the acquired date re-estimates it (this matters for non-vintage wines).
- To record drinking, use [consume](#post-itemsidconsume) instead of lowering `itemQuantity`, so the journal stays right.

### DELETE /items/{id}

Removes the bottles **and their journal entries and value history**. To keep the history of a finished wine, drink the bottles instead (an item with 0 bottles stays in the journal). `200`: `{"deleted": true}`.

## Drinking and the journal

### POST /items/{id}/consume

Records bottles opened, and lowers the count in the same step.

```json
{"quantity": 1, "notes": "Anniversary dinner", "rating": 4.5, "consumedAt": "2026-10-28"}
```

Only `quantity` is required. `consumedAt` can be a date or a date-time; it defaults to now. A date alone is stored as noon UTC that day.

`201`:

```json
{
  "consumption": {
    "consumeID": 1,
    "itemID": 1,
    "collectionId": 1,
    "wineID": 1,
    "wineName": "Château Margaux",
    "wineProducer": null,
    "wineVint": 2010,
    "wineType": "Red",
    "consumeTime": "2026-10-29T21:10:36Z",
    "consumeQuantity": 1,
    "consumeNotes": "Anniversary dinner",
    "consumeRating": 4.5,
    "consumedByUserID": 1,
    "consumedByName": "Frank Delgado"
  },
  "item": { "...the item, with the new itemQuantity...": "" }
}
```

Errors: `400`, `404`, `409 not_enough_bottles` ("There aren't that many bottles left. Nothing was changed."). Nothing is saved when this happens: no journal entry, and no change to the count.

When the last bottle is drunk, the item stays with 0 bottles, so its notes and ratings survive. It's hidden from the cellar list unless `includeEmpty=true`.

### GET /collections/{id}/consumptions

The cellar journal, newest first: `{"consumptions": [ ...consumption objects... ]}`.

### PATCH /consumptions/{id}

Any of `quantity`, `notes`, `rating`, `consumedAt`. Changing `quantity` changes the bottle count by the difference: going from 2 to 3 takes one more bottle; going from 3 to 1 puts two back. `200`: `{"consumption": {...}, "item": {...}}`. Errors: `400`, `404`, `409 not_enough_bottles`.

### DELETE /consumptions/{id}

Removes the entry and **puts its bottles back**. `200`: `{"deleted": true, "item": {...}}`.

### GET /collections/{id}/ready?soonDays=180

Maria's "what should we open?" list. Bottles left, grouped by urgency:

```json
{
  "soonDays": 180,
  "drinkSoon": [ ...items, nearest drink-by first... ],
  "ready": [ ...items, nearest drink-by first, open-ended windows last... ],
  "pastPeak": [ ...items, longest past peak first... ]
}
```

`tooYoung` and `notSet` bottles aren't included. `soonDays` can be 0 to 3650.

## Value

### GET /collections/{id}/value

```json
{
  "collectionId": 1,
  "bottleCount": 9,
  "valuedBottleCount": 5,
  "notValuedBottleCount": 4,
  "totalValueCents": 236600,
  "totalValueFormatted": "$2,366.00",
  "totalPurchaseCostCents": 184000,
  "totalPurchaseCostFormatted": "$1,840.00",
  "gainLossCents": 50000,
  "gainLossFormatted": "$500.00",
  "gainLossCostBasisCents": 180000,
  "gainLossCostBasisFormatted": "$1,800.00",
  "byType": [
    {"wineType": "Red", "bottles": 5, "notValuedBottles": 0, "valueCents": 236600, "valueFormatted": "$2,366.00"},
    {"wineType": "White", "bottles": 4, "notValuedBottles": 4, "valueCents": 0, "valueFormatted": "$0.00"}
  ],
  "topBottles": [ ...up to 5 items, highest value per bottle first... ]
}
```

- Only bottles still in the cellar count.
- `totalValue` adds up valued bottles only. Show `notValuedBottleCount` next to it ("4 bottles not valued") rather than treating them as $0.
- `totalPurchaseCost` adds up every bottle with a purchase price.
- `gainLoss` only counts bottles that have **both** a purchase price and a value. `gainLossCostBasis` is what those bottles cost, so a percentage is `gainLossCents / gainLossCostBasisCents`.

### POST /items/{id}/value

The household records its own value for one bottle of this item. It overrides the catalog value for this item only. Other households never see it.

```json
{"itemValue": 1300}
```

Send `{"itemValue": null}` to go back to the catalog value. `200`: the item. Errors: `400`, `404`.

Catalog values (`wineValue`) only change through [PATCH /wines/{id}](#patch-winesid) by the wine's creator.

### GET /items/{id}/value-history

Value changes over time, oldest first, ready for a chart:

```json
{
  "itemID": 1,
  "wineID": 1,
  "history": [
    {"valueID": 1, "level": "catalog", "valueCents": 115000, "valueFormatted": "$1,150.00", "valueSource": "user", "valueRecordedAt": "2026-10-29T21:10:36Z"},
    {"valueID": 2, "level": "item", "valueCents": 130000, "valueFormatted": "$1,300.00", "valueSource": "user", "valueRecordedAt": "2026-11-02T18:00:00Z"}
  ]
}
```

`level` is `catalog` (the shared wine value) or `item` (this household's own value). You only ever see catalog entries and your own item's entries.

## Insights and reference data

### GET /collections/{id}/stats

```json
{
  "collectionId": 1,
  "bottleCount": 16,
  "itemCount": 7,
  "byType": [{"label": "Red", "bottles": 11, "items": 4}],
  "byRegion": [{"label": "California, USA", "bottles": 4, "items": 1}],
  "byVintageDecade": [{"label": "2010s", "bottles": 12, "items": 6}, {"label": "2020s", "bottles": 4, "items": 1}],
  "byStorageLocation": [{"label": "Not set", "bottles": 16, "items": 7}],
  "bottlesAddedLast30Days": 16,
  "bottlesOpenedLast30Days": 0,
  "averageRating": null,
  "ratingCount": 0
}
```

(This is the demo household, shortened: `byType` and `byRegion` list every group.)

Groups are sorted by bottle count, most first. Missing regions show as "Unknown", missing locations as "Not set", and wines without a vintage as "Non-vintage". `bottlesAddedLast30Days` counts bottles entered in the app in the last 30 days, including ones already drunk. `averageRating` covers every journal entry with a rating, and is `null` if there are none.

### GET /collections/{id}/suggest?pairing=Beef

Bottles that are ready to drink (`drinkSoon` first, then `ready`) and pair with a meal: `{"pairing": "Beef", "items": [ ...items... ]}`. `400` if the pairing isn't one from [GET /pairings](#get-pairings).

### GET /blends

`{"blends": [{"blendID": 11, "blendStyle": "Bordeaux Blend"}, ...]}`, sorted by name.

### GET /pairings

`{"pairings": [{"pairingID": 1, "pairingName": "Beef"}, ...]}`, sorted by name.

### GET /health

Not under `/api/v1`. Returns the plain text `OK`. Used by Docker and monitoring.

## CSV export and import

For moving a cellar in from a spreadsheet (Eric) or a notebook typed up (Frank), and for backups.

The columns, in this order:

| Column | Meaning |
| --- | --- |
| `wineName` | Required. |
| `wineProducer`, `wineRegion` | Optional text. |
| `wineType` | Required. Red, White, Rosé, Sparkling, Dessert, Fortified, Orange. |
| `wineVint` | Year, or empty for non-vintage. |
| `blendStyle` | A name from [GET /blends](#get-blends), like `Nebbiolo`. |
| `wineBarcode` | If a wine with this barcode is already in the catalog, the row uses it, and the row's other wine columns are ignored. |
| `wineValue` | Catalog value per bottle, in dollars. |
| `pairings` | Names from [GET /pairings](#get-pairings), separated with `;`, like `Beef; Lamb`. |
| `itemQuantity` | Required. 1 to 9,999. |
| `itemStoredAt` | Storage location. |
| `itemAquiredDate` | `YYYY-MM-DD`. |
| `itemPurchasePrice` | Dollars, per bottle. |
| `itemValue` | The household's own value per bottle, in dollars. |
| `itemDrinkFrom`, `itemDrinkBy` | `YYYY-MM-DD`. Left empty, the window is estimated. |
| `wineDescription` | Tasting notes. |

### GET /collections/{id}/export.csv

Downloads the bottles still in the cellar as a CSV file with the columns above. Money columns are in dollars, like `1150.00`. A cell that starts with `=`, `+`, `-` or `@` gets a `'` in front, so spreadsheet apps don't run it as a formula. Link to it directly, for example `<a href="/api/v1/collections/1/export.csv">Download CSV</a>`; the login cookie goes along.

### POST /collections/{id}/import

Send the CSV file either as the request body with `Content-Type: text/csv`, or as a form upload (`multipart/form-data`) in a field named `file`:

```js
const form = new FormData();
form.append("file", fileInput.files[0]);
const resp = await fetch(API + "/collections/1/import", { method: "POST", credentials: "include", body: form });
```

Only the `wineName`, `wineType` and `itemQuantity` columns are required. Columns can be in any order. Save the file as "CSV UTF-8" so accented names like Rosé survive. At most 200 rows per file.

`201`: `{"imported": 2, "bottles": 3}`.

**Every row is checked before anything is saved.** If any row has a problem, nothing is imported, and every problem is listed by row number (row 1 is the header):

```json
{
  "error": {
    "code": "import_errors",
    "message": "1 row(s) need fixing. Nothing was imported.",
    "rows": [
      {"row": 3, "fields": {"wineType": "Wine type must be one of: Red, White, Rosé, Sparkling, Dessert, Fortified, Orange.",
                            "itemQuantity": "Quantity must be between 1 and 9,999."}}
    ]
  }
}
```

Other errors: `400 validation_error` with `fields.file` (bad header row, empty file, too many rows, not UTF-8), `404`, `415` (not CSV or a form upload).

## Wishlist

Wines a household wants to remember. It's a list only: no prices, shops, or links to buy. Shared by everyone in the collection.

A wishlist entry:

```json
{
  "wishID": 1,
  "collectionId": 1,
  "wineID": null,
  "wishName": "Opus One",
  "wishProducer": null,
  "wishVint": 2019,
  "wishNotes": "Try for 50th birthday",
  "wishAddedByUserID": 1,
  "wishAddedByName": "Frank Delgado",
  "wishAddedAt": "2026-10-29T21:30:00Z"
}
```

### GET /collections/{id}/wishlist

`{"wishlist": [ ...entries, newest first... ]}`.

### POST /collections/{id}/wishlist

```json
{"wishName": "Opus One", "wishVint": 2019, "wishNotes": "Try for 50th birthday"}
```

Or link a catalog wine with `{"wineId": 1}`, and its name, producer and vintage are filled in. Fields: `wineId`, `wishName` (1 to 120 characters, required unless `wineId` is sent), `wishProducer`, `wishVint`, `wishNotes`. `201`: the entry.

### PATCH /wishlist/{id}

Any of the same fields. `200`: the entry. `404` if it isn't in one of your collections.

### DELETE /wishlist/{id}

`200`: `{"deleted": true}`.

## Replacing localStorage

Today the prototype keeps everything in the browser with `localStorage`. Here's what replaces each function. The pure display helpers can stay as they are.

### js/storage.js

| Function | Replace with |
| --- | --- |
| `DEFAULT_CELLAR` | The demo household on the server. Load it with `python -m vino.seed_demo` (see `backend/README.md`), then log in as the demo user. |
| `loadCellar()` | `GET /collections/{id}/items`. Get `{id}` from `collections[0].collectionId` in `GET /auth/me`. |
| `saveCellar(data)` | No single replacement: save each change as it happens. Add: `POST /collections/{id}/items`. Edit: `PATCH /items/{id}`. Remove: `DELETE /items/{id}`. Drink: `POST /items/{id}/consume`. |
| `calculateCellarStats(data)` | `GET /collections/{id}/value`: `distinctCount` → the item count from the items list (`count`), `totalBottles` → `bottleCount`, `totalValue` → `totalValueCents / 100` or `totalValueFormatted`. `oldestVintage` → the smallest `wine.wineVint` in the items list. |
| `getUserSession()` | `GET /auth/me`. A `401` means not logged in. |
| `saveUserSession(session)` | Nothing. Signup and login set the cookie. |
| `clearUserSession()` | `POST /auth/logout`. |
| `getAccounts()` / `saveAccounts()` | Nothing. Accounts live on the server. |
| `getWineAge(vintage)` | Keep. Pass `wine.wineVint`. |
| `getAppTenureDetails(joinDate)` | Keep. Pass `user.userCreatedAt`. |
| `escapeHtml(str)` | Keep, and keep using it for everything from the API. |

How the prototype's wine fields map to the API's item objects:

| Prototype field | API field |
| --- | --- |
| `id` | `itemID` (the bottles) or `wineID` (the wine) |
| `name` | `wine.wineName` |
| `type` | `wine.wineType` |
| `varietal` | `wine.blendStyle` (one style from `GET /blends`) |
| `region` | `wine.wineRegion` |
| `vintage` | `wine.wineVint` |
| `price` | `currentValueCents / 100`, or `currentValueFormatted` |
| `quantity` | `itemQuantity` |
| `maturity` | `drinkStatus` (`ready`, `drinkSoon`, `pastPeak`, `tooYoung`, `notSet`) |
| `pairings` | `wine.pairings` |
| `notes` | `wine.wineDescription` |
| `pairingGuide` | `wine.wineProfile` |

### js/auth.js

| Prototype code | Replace with |
| --- | --- |
| `hashPassword()` | Remove it. The server hashes passwords properly. Send the password as typed, over HTTPS. |
| Registration branch | `POST /auth/signup` with `userEmail`, `password`, `userFname`, `userLname`. On `409 email_taken`, show the message. On `400`, show `fields` next to the inputs. |
| Login branch | `POST /auth/login` with `userEmail` and `password`. Show `error.message` on `401` and `429`. |
| "Username or email" | Email only. Change the label and placeholder. |
| `password.length < 4` check | The API needs at least 8 characters. Match that so users see the rule before submitting. |
| `getUserSession()` pre-fill | `GET /auth/me`. If it succeeds, the user is already logged in and can skip the login page. |
| Forgot password | Still not available. |
