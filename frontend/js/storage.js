/* ==========================================================================
   Vino — Shared Data Helpers & Utility Functions (storage.js)
   Cellar data now lives on the server (see js/api.js). This file converts
   API data to the shape the pages render, plus small display helpers.
   ========================================================================== */

/**
 * Friendly labels for the API's drinkStatus values.
 */
const MATURITY_LABELS = {
  ready: 'Ready to Enjoy',
  drinkSoon: 'Drink Soon',
  pastPeak: 'Past Peak',
  tooYoung: 'Keep Aging',
  notSet: 'No Drinking Window'
};

/**
 * Converts an API inventory item into the wine object the dashboard renders.
 * price is per bottle in dollars, or null when the wine isn't valued.
 * vintage is null for non-vintage wines. The original item is kept as _item.
 */
function toCellarWine(item) {
  const wine = item.wine || {};
  let maturity = MATURITY_LABELS[item.drinkStatus] || MATURITY_LABELS.notSet;
  if (item.itemDrinkWindowSource === 'estimate' && item.drinkStatus !== 'notSet') {
    maturity += ' (est.)';
  }
  return {
    id: item.itemID,
    name: wine.wineName,
    type: wine.wineType,
    varietal: wine.blendStyle || '',
    region: wine.wineRegion || '',
    vintage: wine.wineVint,
    price: item.currentValueCents === null || item.currentValueCents === undefined ? null : item.currentValueCents / 100,
    quantity: item.itemQuantity,
    maturity,
    pairings: wine.pairings || [],
    notes: wine.wineDescription || '',
    pairingGuide: wine.wineProfile || '',
    _item: item
  };
}

/**
 * Computes high-level analytics over the cellar array.
 * Wines without a value (price null) are skipped in totalValue.
 */
function calculateCellarStats(cellarData) {
  const list = Array.isArray(cellarData) ? cellarData : [];
  const distinctCount = list.length;
  const totalBottles = list.reduce((sum, w) => sum + (Number(w.quantity) || 0), 0);
  const totalValue = list.reduce((sum, w) => w.price === null ? sum : sum + ((Number(w.quantity) || 0) * (Number(w.price) || 0)), 0);

  let oldestVintage = '—';
  if (list.length > 0) {
    const vintages = list.map(w => Number(w.vintage)).filter(v => !isNaN(v) && v > 0);
    if (vintages.length > 0) oldestVintage = Math.min(...vintages);
  }

  return { distinctCount, totalBottles, totalValue, oldestVintage };
}

/**
 * Formats a per-bottle price in dollars, or "Not valued" when null.
 */
function formatPrice(price) {
  if (price === null || price === undefined || isNaN(Number(price))) return 'Not valued';
  return `$${Number(price).toLocaleString()}`;
}

/**
 * Formats a vintage year, or "NV" for non-vintage wines.
 */
function formatVintage(vintage) {
  return vintage ? String(vintage) : 'NV';
}

/**
 * Calculates vintage age string.
 */
function getWineAge(vintage) {
  const currentYear = new Date().getFullYear();
  const v = Number(vintage);
  if (!vintage) return 'Non-vintage';
  if (isNaN(v) || v <= 0) return 'Age unknown';
  const age = currentYear - v;
  if (age <= 0) return 'Current Release';
  if (age === 1) return '1 Year Old';
  return `${age} Years Old`;
}

/**
 * Calculates tenure from a join date string.
 */
function getAppTenureDetails(joinDateStr) {
  const joinDate = new Date(joinDateStr);
  if (isNaN(joinDate.getTime())) {
    return { tenureString: '—', memberSinceString: '' };
  }
  const now = new Date();

  let years = now.getFullYear() - joinDate.getFullYear();
  let months = now.getMonth() - joinDate.getMonth();
  if (months < 0) {
    years--;
    months += 12;
  }

  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'Year' : 'Years'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'Month' : 'Months'}`);
  if (parts.length === 0) parts.push('Less than 1 month');

  const formattedDate = joinDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return {
    tenureString: parts.join(', '),
    memberSinceString: `Member since ${formattedDate}`
  };
}

/**
 * Initials for an avatar from a full name.
 */
function getInitials(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return '—';
}

/**
 * HTML entities escaper for secure dynamic rendering.
 */
function escapeHtml(str) {
  if (str === null || str === undefined || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
