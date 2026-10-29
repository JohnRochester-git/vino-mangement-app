# Schema changes from the Milestone 2 ERD

The database in `backend/migrations/` is built from the team's Milestone 2 ERD and relational schema. This page lists every place it differs, with the reason, so the Milestone 2 documents can be updated to match.

Column names keep the ERD's camelCase spelling. Table names are lowercase versions of the ERD's entity names (`USER` → `user`, `INVENTORY_ITEM` → `inventory_item`, and so on).

## Conventions applied everywhere

| Change | Reason |
| --- | --- |
| All ids are `INTEGER PRIMARY KEY` | The database assigns ids automatically. Exception: `session.sessionID` (below). |
| Dates are text `YYYY-MM-DD`; timestamps are UTC text `YYYY-MM-DDTHH:MM:SSZ` | D1 and SQLite have no date type, and ISO text sorts correctly. |
| Money is stored as whole **cents** (integer) | Avoids rounding errors with decimals. The API accepts and shows dollars. |
| Foreign keys say what happens on delete | Deleting a collection removes its items and memberships. Deleting an item removes its journal entries and value history. A wine can't be deleted while any item uses it. |
| Every foreign key has an index, plus `userEmail`, `wineBarcode`, and `inventory_item(collectionId)` | Fast lookups. |

## USER → `user`

| Change | Reason |
| --- | --- |
| Removed `userPass` | A plain-text password must never be stored. |
| `userPasshash` is no longer unique | Two people can have the same password. Uniqueness on a hash adds nothing and could leak that fact. |
| `userEmail` is unique and always stored lowercase | It's the login name. `Frank@x.com` and `frank@x.com` are the same account. |
| `userFullname` isn't stored | The ERD marks it as derived. The API builds it from `userFname` and `userLname`. |
| Added `userCreatedAt` | Shows "member since" and helps support. |

## COLLECTION → `collection`

| Change | Reason |
| --- | --- |
| `collectionSumValue` isn't stored | It's derived. The API adds it up from the bottles each time, so it can't go stale. |
| `userID` is kept and means "owner" | Matches the ERD. Who else can see the collection is in `collection_member`. |

## New: `collection_member`

`(collectionId, userID, memberRole, memberAddedAt)`, primary key `(collectionId, userID)`. `memberRole` is `owner` or `member`.

**Reason:** one household shares one collection (Frank and Maria see the same bottles). The ERD lets only one user own a collection and has no way to share it.

## WINE → `wine`

| Change | Reason |
| --- | --- |
| Added `wineName` | The ERD has no name, but every screen shows one ("Château Margaux"). |
| Added `wineBarcode` (unique when present) | Epic 1: adding a bottle by scanning its barcode. Stored in one standard form, so a 12-digit UPC and the same code as a 13-digit EAN match. |
| Added `wineImageKey` | Optional pointer to a label photo stored in R2 (the `vino-bottle-images` bucket). |
| Added `wineCreatedAt` and `wineCreatedByUserID` | The catalog is shared, so only the person who added a wine may edit it. Empty for wines nobody owns. |
| Removed `wineBlend` | Duplicated `blendID`. The blend name comes from the `blends` table. |
| `wineValue` is in cents | See money above. It's the catalog's estimate per bottle. A household's own estimate goes on the item instead. |
| `wineVint` may be empty | For non-vintage wines (many Champagnes, for example). |
| `wineType` must be one of Red, White, Rosé, Sparkling, Dessert, Fortified, Orange | Consistent filtering, stats, and drink-window estimates. |

**Wine is a shared catalog**: one row per wine and vintage, reused by every household. One household can't change another household's data:

- Only the wine's creator can edit its catalog details, and only while no other household holds it.
- Corrections and personal values go on the household's own item.

## INVENTORY_ITEM → `inventory_item`

| Change | Reason |
| --- | --- |
| Added `itemPurchasePrice` (cents, optional) | Epic 3: compare what was paid with today's value. |
| Added `itemValue` (cents, optional) | The household's own value estimate. When set, it replaces `wineValue` for this item only. |
| Added `itemDrinkWindowSource` (`estimate`, `provider`, `user`) | So the app can label estimated drinking windows, and so a user's own dates are never overwritten. |
| Added `itemCreatedAt` | Needed for "bottles added in the last 30 days" (the acquired date can be long before the bottle was entered). |
| `itemQuantity` has `CHECK (itemQuantity >= 0)` | Drinking more bottles than exist must fail with an error and undo the whole change. D1 only rolls back a batch on an error. See [d1-bridge.md](d1-bridge.md). |
| `itemDrinkFrom` must be on or before `itemDrinkBy` | Prevents impossible windows. |
| Kept the column name `itemAquiredDate` | It matches the team's documents. **Suggested rename:** `itemAcquiredDate` (spelling). Renaming later needs a new migration and an API change, so decide before the frontend uses it. |

## CONSUMPTION → `consumption`

| Change | Reason |
| --- | --- |
| Added `consumeRating` | 1 to 5 stars in half-star steps, optional. Epic 2: remembering which wines they liked. |
| Added `consumedByUserID` | In a shared household, shows who opened the bottle. |
| `consumeQuantity` must be at least 1 | A journal entry is for at least one bottle. |

## WINE_PAIRING → `wine_pairing`

| Change | Reason |
| --- | --- |
| Primary key is `(wineID, pairingID)` | The ERD underlines only `wineID`, which would allow one pairing per wine. |

## BLENDS and PAIRINGS

No column changes. The `blendStyle` and `pairingName` values are unique, and starting values are loaded by migration `0002_seed_reference_data.sql`.

## New: `value_history`

`(valueID, wineID, itemID, valueCents, valueSource, valueRecordedAt)`. `itemID` is empty for catalog-level values. `valueSource` is `user`, `provider`, or `estimate`.

**Reason:** Epic 3, "how values change over time." A row is written when a wine's catalog value changes (`itemID` empty) or a household sets its own value for an item (`itemID` set). Households see catalog rows plus their own items' rows only. Clearing a value doesn't write a row.

## New: `session`

`(sessionID, userID, sessionCreatedAt, sessionExpiresAt)`.

**Reason:** the backend runs in containers that can be restarted or run several copies at once, so logins can't be kept in memory. `sessionID` is the SHA-256 hash of the random token in the login cookie. It's text, not an integer, because the hash is the id. Expired sessions are deleted at each login.

## New: `login_attempt`

`(attemptID, attemptEmail, attemptAt, attemptSucceeded)`.

**Reason:** slows down password guessing. After 5 failed logins for one email within 15 minutes, that email is locked for 5 minutes. Rows older than one day are deleted at each login.

## Not in the ERD, created by tooling: `d1_migrations`

Records which migration files have run. Wrangler creates and uses it on Cloudflare D1. The local migration command (`python -m vino.migrate`) uses the same table, so local and cloud databases stay in step. It isn't part of the data model.
