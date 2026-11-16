# Sign in with Google: setup

How to switch on "Continue with Google" for the live site, the preview and local development. How it works is in [api.md](api.md#sign-in-with-google); its security is in [security.md](security.md).

Google sign-in stays off (the button is hidden) until all three settings are set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`.

## 1. Create the Google client (Google Cloud Console, once)

1. At console.cloud.google.com, create a project, for example **Vino**.
2. Open **Google Auth Platform** (in older consoles: **APIs & Services → OAuth consent screen**) and set it up:
   - **App name:** Vino. **Support email:** a team address.
   - **Audience:** External.
   - **Scopes:** only `openid`, `email` and `profile`. These are Google's basic scopes.
   - **Publishing:** while the app is in **Testing**, only the Google accounts listed as **test users** (up to 100) can sign in. Add the team and the professor, or publish it if Google allows it for basic scopes without review. Check what the console says; Google's rules on this change.
3. Go to **Clients** (or **Credentials → Create credentials → OAuth client ID**), choose **Web application**, and add these **Authorized redirect URIs**, exactly:
   - `https://www.vinowine.org/api/v1/auth/google/callback`
   - `https://vino-preview.noahvastola.workers.dev/api/v1/auth/google/callback`
   - `http://localhost:8000/api/v1/auth/google/callback` (local development)
4. Copy the **Client ID** and **Client secret**. The secret is a password: store it in a password manager, and never put it in the repo or a chat.

## 2. Turn it on for the live site and the preview

Order matters. The new code writes to a database column that migration `0004` adds, so the database must be migrated **before** the new code is deployed. The migration only adds a column and a table, so the code that's already live keeps working after it.

From `worker/`:

1. **Migrate the test database, then live:**
   ```bash
   npx wrangler d1 migrations apply vino-db-test --env preview --remote
   npx wrangler d1 migrations apply vino-db --env="" --remote
   ```
2. **Set the client secret** for each environment. Wrangler prompts for the value, so it never appears in your shell history:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env=""
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
   ```
   Setting a secret creates a new version of that Worker straight away. That's fine: the button stays hidden until the client ID is set too.
3. **Put the client ID** into both `GOOGLE_CLIENT_ID` values in `worker/wrangler.jsonc` (top level and `env.preview`). It isn't secret. Merge it through a pull request; the pipeline deploys it.
4. **Deploy the preview by hand** (`npx wrangler deploy --env preview`) and try it there first.

## 3. Local development

In `backend/.env`:

```
GOOGLE_CLIENT_ID=<the client ID>
GOOGLE_CLIENT_SECRET=<the client secret>
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/google/callback
FRONTEND_URL=http://localhost:5500
```

Restart the backend (`scripts/stop.py`, then `scripts/start.py`). The local database is migrated automatically on start. Open http://localhost:5500/login.html (`localhost`, not `127.0.0.1`).

## Checking it works

- The login page shows **Continue with Google** under the sign-in button.
- Signing in with Google lands on the welcome page, logged in.
- A Google account with the same email as an existing password account signs into that account; the password keeps working too.
- If something goes wrong, the login page says so (`?error=google_failed`), and the backend's log says why (Workers & Pages → `vino` → Logs).

## Turning it off

Set `GOOGLE_CLIENT_ID` back to `""` and deploy. The button disappears; accounts created through Google can't sign in until it's back, because they have no password.
