"""Wine values.

Rules:
- An item's current value per bottle is its itemValue (the household's own
  estimate) when set, otherwise the catalog wineValue.
- Collection value sums quantity x value per bottle over items with bottles
  left. Items with no value at all are reported as "not valued", never $0.
- Gain/loss only counts items with both a purchase price and a value.
"""


class ValuationProvider:
    """Interface for an outside source of catalog values.

    lookup(wine) returns a value in integer cents, or None when unknown.
    """

    name = "none"

    def lookup(self, wine):
        raise NotImplementedError


class NoValuationProvider(ValuationProvider):
    """Default: no outside source. Values come from what users enter
    (recorded with valueSource = 'user')."""

    def lookup(self, wine):
        return None


def get_provider():
    return NoValuationProvider()


def current_value(item_value, wine_value):
    """(cents per bottle, source) where source is 'item', 'wine' or None."""
    if item_value is not None:
        return item_value, "item"
    if wine_value is not None:
        return wine_value, "wine"
    return None, None


def gain_loss(per_bottle_value, purchase_price, quantity):
    if per_bottle_value is None or purchase_price is None:
        return None
    return (per_bottle_value - purchase_price) * quantity
