/* ==========================================================================
   Vino — Shared Storage, Data Models & Utility Functions (storage.js)
   ========================================================================== */

const STORAGE_KEY = 'vino_cellar_inventory_v2';
const ACCOUNTS_KEY = 'vino_accounts';
const USER_KEY = 'vino_user';
const UNCORK_LOG_KEY = 'vino_uncork_log_v1';

/**
 * Initial Seeded Uncorked Log (Matches 5 bottles enjoyed stat)
 */
const DEFAULT_UNCORK_LOG = [
  {
    id: 'uncork_seed_1',
    wineId: 'wine_margaux_2010',
    name: 'Château Margaux',
    vintage: 2010,
    type: 'Red',
    varietal: 'Bordeaux Blend (Cabernet / Merlot)',
    region: 'Margaux, Bordeaux, France',
    dateStr: 'Nov 4, 2026',
    timestamp: 1793836800000,
    note: 'Celebratory anniversary tasting. Silky, opulent, and legendary length.'
  },
  {
    id: 'uncork_seed_2',
    wineId: 'wine_chablis_2019',
    name: 'Chablis Grand Cru',
    vintage: 2019,
    type: 'White',
    varietal: 'Chardonnay',
    region: 'Les Clos, Burgundy, France',
    dateStr: 'Oct 28, 2026',
    timestamp: 1793232000000,
    note: 'Paired with fresh oysters and Maine sea scallops. Crisp mineral perfection.'
  },
  {
    id: 'uncork_seed_3',
    wineId: 'wine_barolo_2016',
    name: 'Barolo, Falletto',
    vintage: 2016,
    type: 'Red',
    varietal: 'Nebbiolo',
    region: 'Piedmont, Italy',
    dateStr: 'Oct 14, 2026',
    timestamp: 1792022400000,
    note: 'Accompanied braised beef short ribs. Noble alpine tannins.'
  },
  {
    id: 'uncork_seed_4',
    wineId: 'wine_champagne_2012',
    name: 'Dom Pérignon Vintage',
    vintage: 2012,
    type: 'Sparkling',
    varietal: 'Champagne Blend',
    region: 'Champagne, France',
    dateStr: 'Sep 20, 2026',
    timestamp: 1789948800000,
    note: 'Toast with close friends. Toasted brioche and vibrant bubbles.'
  },
  {
    id: 'uncork_seed_5',
    wineId: 'wine_josh_2020',
    name: 'Josh Cellars Craftsman',
    vintage: 2020,
    type: 'Red',
    varietal: 'Cabernet Sauvignon',
    region: 'California, USA',
    dateStr: 'Aug 18, 2026',
    timestamp: 1787097600000,
    note: 'Casual backyard barbecue smash burgers. Smooth and fruit-forward.'
  }
];

/**
 * Initial Luxury Cellar Demo Collection (7 wines, 16 bottles, $3,867 value)
 */
const DEFAULT_CELLAR = [
  {
    id: "wine_margaux_2010",
    name: "Château Margaux",
    type: "Red",
    varietal: "Bordeaux Blend (Cabernet / Merlot)",
    region: "Margaux, Bordeaux, France",
    vintage: 2010,
    price: 1150,
    quantity: 2,
    maturity: "Peak Maturity",
    pairings: ["Beef", "Lamb", "Cheese"],
    notes: "First Growth Premier Grand Cru Classé. Silky tannins with opulent notes of crushed violets, blackcurrant, dark truffles, and cigar box. Spectacular longevity.",
    pairingGuide: "Exceptional alongside prime grilled ribeye, roasted venison saddle, and aged Comté or farmhouse Cheddar."
  },
  {
    id: "wine_yquem_2015",
    name: "Château d'Yquem",
    type: "Dessert",
    varietal: "Sauternes (Sémillon / Sauvignon Blanc)",
    region: "Sauternes, Bordeaux, France",
    vintage: 2015,
    price: 450,
    quantity: 1,
    maturity: "Aging Gracefully",
    pairings: ["Dessert", "Cheese", "Poultry"],
    notes: "The undisputed king of sweet Bordeaux. Honeyed apricot, candied citrus peel, white peach, roasted hazelnut, and incredible botrytis acidity.",
    pairingGuide: "Glorious with pan-seared foie gras, artisanal Roquefort blue cheese, and fruit tarte tatin."
  },
  {
    id: "wine_barolo_2016",
    name: "Barolo, Falletto",
    type: "Red",
    varietal: "Nebbiolo",
    region: "Piedmont, Italy",
    vintage: 2016,
    price: 180,
    quantity: 2,
    maturity: "Peak Maturity",
    pairings: ["Beef", "Pasta", "Lamb", "Cheese"],
    notes: "Bruno Giacosa classic. Alluring aromas of wild red cherries, dried rose petals, leather, tar, and noble alpine tannins with great structure.",
    pairingGuide: "Perfect with braised beef short ribs, white truffle risotto, and rich pappardelle al ragù."
  },
  {
    id: "wine_chablis_2019",
    name: "Chablis Grand Cru",
    type: "White",
    varietal: "Chardonnay",
    region: "Les Clos, Burgundy, France",
    vintage: 2019,
    price: 120,
    quantity: 2,
    maturity: "Ready to Enjoy",
    pairings: ["Seafood", "Poultry", "Salad", "Cheese"],
    notes: "Pristine flinty minerality, lemon curd, crushed chalk, and saline freshness. Subtle oak texture with vibrant cool-climate Burgundy tension.",
    pairingGuide: "Flawless with fresh Brittany oysters, butter-poached Maine lobster, scallops, and Dover sole."
  },
  {
    id: "wine_champagne_2012",
    name: "Dom Pérignon Vintage",
    type: "Sparkling",
    varietal: "Champagne Blend (Chardonnay / Pinot)",
    region: "Champagne, France",
    vintage: 2012,
    price: 190,
    quantity: 2,
    maturity: "Ready to Enjoy",
    pairings: ["Seafood", "Charcuterie", "Cheese"],
    notes: "Intense, smoky brioche, toasted almonds, lemon blossom, and a creamy, persistent mousse with vibrant chalky acidity.",
    pairingGuide: "Pairs divinely with Ossetra caviar, Iberico ham, tempura prawns, and triple-crème Brie."
  },
  {
    id: "wine_josh_2020",
    name: "Josh Cellars Craftsman",
    type: "Red",
    varietal: "Cabernet Sauvignon",
    region: "California, USA",
    vintage: 2020,
    price: 22,
    quantity: 4,
    maturity: "Ready to Enjoy",
    pairings: ["Beef", "Pasta", "Cheese"],
    notes: "Fruit-forward and approachable. Aromas of ripe black cherries, toasted hazelnut, mocha, and smooth French vanilla oak.",
    pairingGuide: "An everyday favorite with smash burgers, BBQ sliders, pepperoni flatbread, and spaghetti Bolognese."
  },
  {
    id: "wine_riscal_2018",
    name: "Marqués de Riscal Reserva",
    type: "Red",
    varietal: "Tempranillo / Graciano",
    region: "Rioja, Spain",
    vintage: 2018,
    price: 17,
    quantity: 3,
    maturity: "Peak Maturity",
    pairings: ["Lamb", "Charcuterie", "Cheese", "Pasta"],
    notes: "Classic Rioja complexity. Ripe blackberry, balsamic balsamic nuances, clove, coconut-vanilla from oak aging, and resolved velvety tannins.",
    pairingGuide: "Pair with roasted lamb chops with rosemary, jamón Serrano, chorizo, and Manchego cheese."
  }
];

/**
 * Loads the cellar collection from localStorage.
 * If empty or corrupt, seeds it with DEFAULT_CELLAR.
 */
function loadCellar() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to parse saved cellar, loading defaults', e);
  }
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CELLAR));
  saveCellar(defaults);
  return defaults;
}

/**
 * Saves cellar collection to localStorage.
 */
function saveCellar(cellarData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cellarData));
  } catch (e) {
    console.error('Storage error saving cellar', e);
  }
}

/**
 * Computes high-level analytics over the cellar array.
 */
function calculateCellarStats(cellarData) {
  const list = Array.isArray(cellarData) ? cellarData : [];
  const distinctCount = list.length;
  const totalBottles = list.reduce((sum, w) => sum + (Number(w.quantity) || 0), 0);
  const totalValue = list.reduce((sum, w) => sum + ((Number(w.quantity) || 0) * (Number(w.price) || 0)), 0);

  let oldestVintage = '—';
  if (list.length > 0) {
    const vintages = list.map(w => Number(w.vintage)).filter(v => !isNaN(v) && v > 0);
    if (vintages.length > 0) oldestVintage = Math.min(...vintages);
  }

  return { distinctCount, totalBottles, totalValue, oldestVintage };
}

/**
 * Retrieves the currently active user session.
 */
function getUserSession() {
  try {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Saves or updates user session in localStorage.
 */
function saveUserSession(session) {
  localStorage.setItem(USER_KEY, JSON.stringify(session));
}

/**
 * Clears current user session (sign out).
 */
function clearUserSession() {
  localStorage.removeItem(USER_KEY);
}

/**
 * Retrieves stored user accounts array.
 */
function getAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Saves accounts array to localStorage.
 */
function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/**
 * Calculates vintage age string.
 */
function getWineAge(vintage) {
  const currentYear = new Date().getFullYear();
  const v = Number(vintage);
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
  const joinDate = new Date(joinDateStr || '2024-10-15');
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
 * Loads the uncorked bottle log from localStorage.
 */
function getUncorkLog() {
  try {
    const raw = localStorage.getItem(UNCORK_LOG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Error reading uncork log:', e);
  }
  const seeded = JSON.parse(JSON.stringify(DEFAULT_UNCORK_LOG));
  saveUncorkLog(seeded);
  return seeded;
}

/**
 * Saves uncorked log array to localStorage.
 */
function saveUncorkLog(log) {
  try {
    localStorage.setItem(UNCORK_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.error('Error saving uncork log:', e);
  }
}

/**
 * Logs a new bottle uncorking event.
 */
function logUncorkEvent(wine, customNote = '') {
  if (!wine) return;
  const log = getUncorkLog();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const newEntry = {
    id: 'uncork_' + Date.now(),
    wineId: wine.id,
    name: wine.name,
    vintage: wine.vintage,
    type: wine.type,
    varietal: wine.varietal || (wine.type + ' Wine'),
    region: wine.region || 'Cellar Collection',
    dateStr: `${dateStr} at ${timeStr}`,
    timestamp: now.getTime(),
    note: customNote || (wine.pairings && wine.pairings.length ? `Paired with ${wine.pairings.slice(0, 2).join(' & ')}` : 'Enjoyed from personal cellar')
  };

  log.unshift(newEntry);
  if (log.length > 50) log.length = 50;
  saveUncorkLog(log);
  return newEntry;
}

/**
 * HTML entities escaper for secure dynamic rendering.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
