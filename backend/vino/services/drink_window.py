"""Drinking windows: when a bottle is best to drink, and its status today."""

from datetime import date, timedelta

from ..util import today

# ---------------------------------------------------------------------------
# DRINK-WINDOW ESTIMATE TABLE: tune these.
# Years after the vintage (or after the acquired date, for non-vintage wines)
# that a wine of each type starts and stops being at its best. Placeholder
# ranges from the build brief; rough rules of thumb, not expert data.
# ---------------------------------------------------------------------------
ESTIMATE_YEARS = {
    #  type        (from, to)
    "Sparkling": (1, 5),
    "White": (1, 5),
    "Rosé": (0, 2),
    "Orange": (1, 5),
    "Red": (3, 12),
    "Dessert": (5, 25),
    "Fortified": (5, 30),
}

DEFAULT_SOON_DAYS = 180


class DrinkWindowProvider:
    """Interface: return (drink_from, drink_by, source) as ISO dates, or
    (None, None, None) when no window can be given."""

    def window(self, wine_type, vintage, acquired_date=None):
        raise NotImplementedError


class RuleBasedEstimator(DrinkWindowProvider):
    """Default provider: estimates from wine type and vintage using
    ESTIMATE_YEARS. Non-vintage wines count from the acquired date (or today)."""

    def window(self, wine_type, vintage, acquired_date=None):
        years = ESTIMATE_YEARS.get(wine_type)
        if years is None:
            return None, None, None
        start, end = years
        if vintage:
            drink_from = date(vintage + start, 1, 1)
            drink_by = date(vintage + end, 12, 31)
        else:
            base = date.fromisoformat(acquired_date) if acquired_date else today()
            drink_from = _add_years(base, start)
            drink_by = _add_years(base, end)
        return drink_from.isoformat(), drink_by.isoformat(), "estimate"


def _add_years(d, years):
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 February
        return d.replace(year=d.year + years, day=28)


def get_provider():
    # Only the rule-based estimator exists today. A real data source would be
    # selected here from an environment variable, like the barcode provider.
    return RuleBasedEstimator()


def drink_status(drink_from, drink_by, today, soon_days=DEFAULT_SOON_DAYS):
    """notSet | tooYoung | ready | drinkSoon | pastPeak.

    Boundaries: the drink-from day counts as ready; the drink-by day itself is
    still drinkable (drinkSoon), and pastPeak starts the day after it.
    """
    if not drink_from and not drink_by:
        return "notSet"
    if drink_from and today < date.fromisoformat(drink_from):
        return "tooYoung"
    if drink_by:
        by = date.fromisoformat(drink_by)
        if today > by:
            return "pastPeak"
        if today >= by - timedelta(days=soon_days):
            return "drinkSoon"
    return "ready"
