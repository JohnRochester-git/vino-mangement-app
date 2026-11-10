-- Migration number: 0003  Wishlist
-- Wines a household wants to remember. A list only: no prices, stores or links.

CREATE TABLE wishlist_item (
    wishID            INTEGER PRIMARY KEY,
    collectionId      INTEGER NOT NULL REFERENCES collection (collectionId) ON DELETE CASCADE,
    wineID            INTEGER REFERENCES wine (wineID) ON DELETE SET NULL,
    wishName          TEXT NOT NULL,
    wishProducer      TEXT,
    wishVint          INTEGER CHECK (wishVint IS NULL OR wishVint BETWEEN 1800 AND 2200),
    wishNotes         TEXT,
    wishAddedByUserID INTEGER REFERENCES user (userID) ON DELETE SET NULL,
    wishAddedAt       TEXT NOT NULL
);
CREATE INDEX idx_wishlist_item_collection ON wishlist_item (collectionId);
CREATE INDEX idx_wishlist_item_wine ON wishlist_item (wineID);
CREATE INDEX idx_wishlist_item_user ON wishlist_item (wishAddedByUserID);
