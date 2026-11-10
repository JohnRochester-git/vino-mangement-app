"""Barcode lookup providers.

The API checks the local wine catalog first (see api/wines.py), then the
provider configured by BARCODE_PROVIDER:

- "none" (default): no outside lookup. Only wines already in the catalog
  are found.
- "openfoodfacts": Open Food Facts (https://world.openfoodfacts.org), a free,
  open product database that includes wines. No API key needed. Its terms ask
  every app to send a User-Agent naming the app and a contact address, set
  with BARCODE_CONTACT. Product reads are limited to 15 requests per minute
  per IP. Data is under the Open Database License (ODbL), contributed by
  volunteers, with no guarantee of accuracy, so users always confirm what it
  returns. Details are in docs/api.md.

Any failure (timeout, network error, bad response) is treated as "not found".
"""

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger(__name__)


class BarcodeProvider:
    """Interface: lookup(code) returns a dict of wine fields, or None."""

    name = "none"

    def lookup(self, code):
        raise NotImplementedError


class NoBarcodeProvider(BarcodeProvider):
    def lookup(self, code):
        return None


# Open Food Facts category tags -> our wine types. Checked in order.
_OFF_TYPE_TAGS = [
    ("en:champagnes", "Sparkling"),
    ("en:sparkling-wines", "Sparkling"),
    ("en:rose-wines", "Rosé"),
    ("en:orange-wines", "Orange"),
    ("en:fortified-wines", "Fortified"),
    ("en:ports", "Fortified"),
    ("en:sherries", "Fortified"),
    ("en:dessert-wines", "Dessert"),
    ("en:sweet-wines", "Dessert"),
    ("en:red-wines", "Red"),
    ("en:white-wines", "White"),
]


class OpenFoodFactsProvider(BarcodeProvider):
    name = "openfoodfacts"
    url = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
    fields = "product_name,brands,categories_tags,origins,countries"

    def __init__(self, contact, timeout=3.0, opener=None):
        self.user_agent = f"VinoCellar/1.0 ({contact or 'contact not set'})"
        self.timeout = timeout
        self.opener = opener or urllib.request.urlopen

    def lookup(self, code):
        url = self.url.format(code=urllib.parse.quote(code)) + "?fields=" + self.fields
        req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": "application/json"})
        try:
            with self.opener(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code != 404:
                log.warning("Open Food Facts lookup failed: HTTP %s", err.code)
            return None
        except Exception as err:  # timeouts, network errors, bad JSON
            log.warning("Open Food Facts lookup failed: %s", err)
            return None
        if not isinstance(body, dict) or body.get("status") != 1:
            return None
        return self.map_product(body.get("product") or {})

    @staticmethod
    def map_product(product):
        """Map an Open Food Facts product to our wine fields. Anything we
        can't tell for sure is left out for the user to fill in."""
        if not isinstance(product, dict):
            return None
        tags = product.get("categories_tags") or []
        if not isinstance(tags, list):
            tags = []
        if not any(_is_wine_tag(t) for t in tags):
            # A product, but not a wine (water, beer...). Don't pretend.
            return None
        name = _clean(product.get("product_name"))
        if not name:
            return None
        wine = {"wineName": name[:120]}
        brand = _clean((product.get("brands") or "").split(",")[0])
        if brand:
            wine["wineProducer"] = brand[:120]
        for tag, wine_type in _OFF_TYPE_TAGS:
            if tag in tags:
                wine["wineType"] = wine_type
                break
        vintage = re.search(r"\b(18|19|20)\d{2}\b", name)
        if vintage:
            wine["wineVint"] = int(vintage.group(0))
        return wine


def _is_wine_tag(tag):
    return isinstance(tag, str) and (
        tag == "en:wines" or tag.endswith("-wines") or tag in ("en:champagnes", "en:ports", "en:sherries")
    )


def _clean(value):
    return value.strip() if isinstance(value, str) else ""


def get_provider(config):
    if config.barcode_provider == "openfoodfacts":
        return OpenFoodFactsProvider(config.barcode_contact, timeout=config.provider_timeout)
    return NoBarcodeProvider()
