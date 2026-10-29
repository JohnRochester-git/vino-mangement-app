-- Migration number: 0001  Initial schema
-- Based on the team's Milestone 2 ERD. Every change from the ERD is listed
-- in docs/schema-changes.md.
--
-- Conventions: INTEGER PRIMARY KEY ids, camelCase columns, ISO 8601 text for
-- dates (YYYY-MM-DD) and UTC timestamps (YYYY-MM-DDTHH:MM:SSZ), money in
-- integer cents. No BEGIN/COMMIT: D1 applies each migration file itself.

CREATE TABLE user (
    userID        INTEGER PRIMARY KEY,
    userEmail     TEXT NOT NULL CHECK (userEmail = lower(userEmail)),
    userPasshash  TEXT NOT NULL,
    userFname     TEXT NOT NULL,
    userLname     TEXT NOT NULL,
    userCreatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_user_email ON user (userEmail);

CREATE TABLE collection (
    collectionId   INTEGER PRIMARY KEY,
    collectionName TEXT NOT NULL,
    userID         INTEGER NOT NULL REFERENCES user (userID) ON DELETE CASCADE
);
CREATE INDEX idx_collection_user ON collection (userID);

CREATE TABLE collection_member (
    collectionId  INTEGER NOT NULL REFERENCES collection (collectionId) ON DELETE CASCADE,
    userID        INTEGER NOT NULL REFERENCES user (userID) ON DELETE CASCADE,
    memberRole    TEXT NOT NULL CHECK (memberRole IN ('owner', 'member')),
    memberAddedAt TEXT NOT NULL,
    PRIMARY KEY (collectionId, userID)
);
CREATE INDEX idx_collection_member_user ON collection_member (userID);

CREATE TABLE blends (
    blendID    INTEGER PRIMARY KEY,
    blendStyle TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_blends_style ON blends (blendStyle);

CREATE TABLE pairings (
    pairingID   INTEGER PRIMARY KEY,
    pairingName TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_pairings_name ON pairings (pairingName);

CREATE TABLE wine (
    wineID              INTEGER PRIMARY KEY,
    wineName            TEXT NOT NULL,
    wineProducer        TEXT,
    wineRegion          TEXT,
    wineType            TEXT NOT NULL CHECK (wineType IN ('Red', 'White', 'Rosé', 'Sparkling', 'Dessert', 'Fortified', 'Orange')),
    wineVint            INTEGER CHECK (wineVint IS NULL OR wineVint BETWEEN 1800 AND 2200),
    wineDescription     TEXT,
    wineProfile         TEXT,
    wineValue           INTEGER CHECK (wineValue IS NULL OR wineValue >= 0),
    blendID             INTEGER REFERENCES blends (blendID) ON DELETE SET NULL,
    wineBarcode         TEXT,
    wineImageKey        TEXT,
    wineCreatedAt       TEXT NOT NULL,
    wineCreatedByUserID INTEGER REFERENCES user (userID) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_wine_barcode ON wine (wineBarcode);
CREATE INDEX idx_wine_blend ON wine (blendID);
CREATE INDEX idx_wine_created_by ON wine (wineCreatedByUserID);

CREATE TABLE wine_pairing (
    wineID    INTEGER NOT NULL REFERENCES wine (wineID) ON DELETE CASCADE,
    pairingID INTEGER NOT NULL REFERENCES pairings (pairingID) ON DELETE CASCADE,
    PRIMARY KEY (wineID, pairingID)
);
CREATE INDEX idx_wine_pairing_pairing ON wine_pairing (pairingID);

CREATE TABLE inventory_item (
    itemID                INTEGER PRIMARY KEY,
    wineID                INTEGER NOT NULL REFERENCES wine (wineID) ON DELETE RESTRICT,
    collectionId          INTEGER NOT NULL REFERENCES collection (collectionId) ON DELETE CASCADE,
    itemQuantity          INTEGER NOT NULL CHECK (itemQuantity >= 0),
    itemStoredAt          TEXT,
    itemAquiredDate       TEXT,
    itemDrinkFrom         TEXT,
    itemDrinkBy           TEXT,
    itemDrinkWindowSource TEXT CHECK (itemDrinkWindowSource IS NULL OR itemDrinkWindowSource IN ('estimate', 'provider', 'user')),
    itemPurchasePrice     INTEGER CHECK (itemPurchasePrice IS NULL OR itemPurchasePrice >= 0),
    itemValue             INTEGER CHECK (itemValue IS NULL OR itemValue >= 0),
    itemCreatedAt         TEXT NOT NULL,
    CHECK (itemDrinkFrom IS NULL OR itemDrinkBy IS NULL OR itemDrinkFrom <= itemDrinkBy)
);
CREATE INDEX idx_inventory_item_collection ON inventory_item (collectionId);
CREATE INDEX idx_inventory_item_wine ON inventory_item (wineID);

CREATE TABLE consumption (
    consumeID        INTEGER PRIMARY KEY,
    itemID           INTEGER NOT NULL REFERENCES inventory_item (itemID) ON DELETE CASCADE,
    consumeTime      TEXT NOT NULL,
    consumeQuantity  INTEGER NOT NULL CHECK (consumeQuantity >= 1),
    consumeNotes     TEXT,
    consumeRating    REAL CHECK (consumeRating IS NULL OR (consumeRating BETWEEN 1 AND 5 AND consumeRating * 2 = CAST(consumeRating * 2 AS INTEGER))),
    consumedByUserID INTEGER REFERENCES user (userID) ON DELETE SET NULL
);
CREATE INDEX idx_consumption_item ON consumption (itemID);
CREATE INDEX idx_consumption_user ON consumption (consumedByUserID);

CREATE TABLE value_history (
    valueID         INTEGER PRIMARY KEY,
    wineID          INTEGER NOT NULL REFERENCES wine (wineID) ON DELETE CASCADE,
    itemID          INTEGER REFERENCES inventory_item (itemID) ON DELETE CASCADE,
    valueCents      INTEGER NOT NULL CHECK (valueCents >= 0),
    valueSource     TEXT NOT NULL CHECK (valueSource IN ('user', 'provider', 'estimate')),
    valueRecordedAt TEXT NOT NULL
);
CREATE INDEX idx_value_history_wine ON value_history (wineID);
CREATE INDEX idx_value_history_item ON value_history (itemID);

-- sessionID is the SHA-256 hash of the random token in the cookie.
CREATE TABLE session (
    sessionID        TEXT PRIMARY KEY,
    userID           INTEGER NOT NULL REFERENCES user (userID) ON DELETE CASCADE,
    sessionCreatedAt TEXT NOT NULL,
    sessionExpiresAt TEXT NOT NULL
);
CREATE INDEX idx_session_user ON session (userID);
CREATE INDEX idx_session_expires ON session (sessionExpiresAt);

CREATE TABLE login_attempt (
    attemptID        INTEGER PRIMARY KEY,
    attemptEmail     TEXT NOT NULL,
    attemptAt        TEXT NOT NULL,
    attemptSucceeded INTEGER NOT NULL CHECK (attemptSucceeded IN (0, 1))
);
CREATE INDEX idx_login_attempt_email_at ON login_attempt (attemptEmail, attemptAt);
CREATE INDEX idx_login_attempt_at ON login_attempt (attemptAt);
