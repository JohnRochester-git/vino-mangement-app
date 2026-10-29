/* ==========================================================================
   Vino — Backend API Helper (api.js)
   Every call to the backend goes through api(). Load this file first on
   every page, before storage.js and the page script.
   ========================================================================== */

const LOCAL_DEV_PORT = 5500;
const NETWORK_ERROR_MESSAGE = "Can't reach the Vino server. Is the backend running?";

/**
 * Works out where the API lives:
 * - Local development (localhost or 127.0.0.1): the backend on port 8000 of the
 *   SAME hostname. Cookies for localhost and 127.0.0.1 are separate, so mixing
 *   them would break login.
 * - Live site: /api/v1 on the same domain as the pages.
 */
function getApiBase() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `http://${host}:8000/api/v1`;
  }
  return '/api/v1';
}

const API_BASE = getApiBase();

/**
 * True when a page was opened straight from a file (file://). The session
 * cookie can't work there, so nothing would.
 */
function isOpenedAsFile() {
  return window.location.protocol === 'file:';
}

/**
 * Replaces the page with a message explaining how to serve it. Uses inline
 * styles from index.html's redirect page, so no stylesheet is needed.
 */
function showServeFromHttpMessage() {
  document.body.innerHTML = `
    <div style="background:#150A0C; color:#F2E9E4; font-family:sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box;">
      <div style="max-width:560px; line-height:1.6;">
        <h2 style="color:#C9A15B; margin-top:0;">Open Vino from a local web server</h2>
        <p>This page was opened straight from a file, so it can't log in or reach the Vino server.</p>
        <p>From the main folder of the repo, run:</p>
        <p><code style="color:#C9A15B;">py -m http.server ${LOCAL_DEV_PORT}</code> (Windows)<br>
           <code style="color:#C9A15B;">python3 -m http.server ${LOCAL_DEV_PORT}</code> (Mac or Linux)</p>
        <p>Then open <a href="http://localhost:${LOCAL_DEV_PORT}/login.html" style="color:#C9A15B;">http://localhost:${LOCAL_DEV_PORT}/login.html</a></p>
      </div>
    </div>`;
}

function isLoginPage() {
  return /\/login\.html$/.test(window.location.pathname);
}

/**
 * Calls the API and returns the parsed JSON.
 * On failure it throws { status, code, message, fields }, where message is
 * already written for users. On a 401 (not logged in) from any page except
 * login, it sends the user to login.html and never settles.
 */
async function api(method, path, body) {
  let resp;
  try {
    resp = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (networkError) {
    throw { status: 0, code: 'network_error', message: NETWORK_ERROR_MESSAGE, fields: null };
  }

  let data = null;
  try {
    data = await resp.json();
  } catch (parseError) {
    data = null;
  }

  if (resp.status === 401 && !isLoginPage()) {
    window.location.href = 'login.html';
    return new Promise(() => {}); // the page is leaving; stop the caller here
  }

  if (!resp.ok || data === null) {
    const err = (data && data.error) || {};
    throw {
      status: resp.status,
      code: err.code || 'unexpected_response',
      message: err.message || `The Vino server sent an unexpected response (${resp.status}). Please try again.`,
      fields: err.fields || null,
    };
  }
  return data;
}

/**
 * The first field message from a validation error, or the general message.
 */
function firstErrorMessage(err) {
  if (err && err.fields) {
    const first = Object.values(err.fields)[0];
    if (first) return first;
  }
  return (err && err.message) || 'Something went wrong. Please try again.';
}

// ---- Named wrappers -------------------------------------------------------

function getMe() { return api('GET', '/auth/me'); }

function login(userEmail, password) {
  return api('POST', '/auth/login', { userEmail, password });
}

function signup(userEmail, password, userFname, userLname) {
  return api('POST', '/auth/signup', { userEmail, password, userFname, userLname });
}

function logout() { return api('POST', '/auth/logout'); }

function listItems(collectionId, includeEmpty = false) {
  return api('GET', `/collections/${collectionId}/items${includeEmpty ? '?includeEmpty=true' : ''}`);
}

function addItem(collectionId, body) {
  return api('POST', `/collections/${collectionId}/items`, body);
}

function updateItem(itemId, changes) { return api('PATCH', `/items/${itemId}`, changes); }

function deleteItem(itemId) { return api('DELETE', `/items/${itemId}`); }

function consumeItem(itemId, quantity = 1, extra = {}) {
  return api('POST', `/items/${itemId}/consume`, Object.assign({ quantity }, extra));
}

function getValue(collectionId) { return api('GET', `/collections/${collectionId}/value`); }

function listConsumptions(collectionId) { return api('GET', `/collections/${collectionId}/consumptions`); }

function getBlends() { return api('GET', '/blends'); }

function getPairings() { return api('GET', '/pairings'); }

// Stop here on a page opened from a file, before any page script runs.
if (isOpenedAsFile()) {
  document.addEventListener('DOMContentLoaded', showServeFromHttpMessage);
}
