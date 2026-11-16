-- Migration number: 0004  Sign in with Google
-- userGoogleSub: Google's permanent ID for the account ("sub" in its ID token).
-- Set when someone signs in with Google; NULL for password-only accounts.
-- Accounts created through Google have no password: their userPasshash is
-- '!google', which can never match a password.

ALTER TABLE user ADD COLUMN userGoogleSub TEXT;
CREATE UNIQUE INDEX idx_user_google_sub ON user (userGoogleSub) WHERE userGoogleSub IS NOT NULL;

-- One row per sign-in started with Google, deleted when it completes or after
-- 10 minutes. Stored in the database (not a cookie) so any container instance
-- can finish a sign-in another one started.
CREATE TABLE oauth_state (
    stateHash    TEXT PRIMARY KEY,  -- SHA-256 of the state sent to Google
    codeVerifier TEXT NOT NULL,     -- PKCE verifier for the token exchange
    nonce        TEXT NOT NULL,     -- must come back inside the ID token
    stateCreatedAt TEXT NOT NULL
);
CREATE INDEX idx_oauth_state_created ON oauth_state (stateCreatedAt);
