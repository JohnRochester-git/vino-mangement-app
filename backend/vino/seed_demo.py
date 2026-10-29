"""Load the demo household: one user and the same wines as DEFAULT_CELLAR in
js/storage.js, so the demo looks like today's prototype.

    DEMO_PASSWORD=choose-one python -m vino.seed_demo

Optional: DEMO_EMAIL (default demo@example.com). Local SQLite only; this
refuses to run against D1, and it isn't a migration, so it never touches the
live database. It goes through the API itself, so every rule still applies.
"""

import json
import os
import sys

from . import create_app
from .config import Config

DEMO_WINES = [
    # (wine fields, blend style, quantity) from DEFAULT_CELLAR in js/storage.js.
    # price -> wineValue, notes -> wineDescription, pairingGuide -> wineProfile.
    ({"wineName": "Château Margaux", "wineType": "Red", "wineRegion": "Margaux, Bordeaux, France", "wineVint": 2010,
      "wineValue": 1150, "pairings": ["Beef", "Lamb", "Cheese"],
      "wineDescription": "First Growth Premier Grand Cru Classé. Silky tannins with opulent notes of crushed violets, blackcurrant, dark truffles, and cigar box. Spectacular longevity.",
      "wineProfile": "Exceptional alongside prime grilled ribeye, roasted venison saddle, and aged Comté or farmhouse Cheddar."},
     "Bordeaux Blend", 2),
    ({"wineName": "Château d'Yquem", "wineType": "Dessert", "wineRegion": "Sauternes, Bordeaux, France", "wineVint": 2015,
      "wineValue": 450, "pairings": ["Dessert", "Cheese", "Poultry"],
      "wineDescription": "The undisputed king of sweet Bordeaux. Honeyed apricot, candied citrus peel, white peach, roasted hazelnut, and incredible botrytis acidity.",
      "wineProfile": "Glorious with pan-seared foie gras, artisanal Roquefort blue cheese, and fruit tarte tatin."},
     "Sauternes Blend", 1),
    ({"wineName": "Barolo, Falletto", "wineType": "Red", "wineRegion": "Piedmont, Italy", "wineVint": 2016,
      "wineValue": 180, "pairings": ["Beef", "Pasta", "Lamb", "Cheese"],
      "wineDescription": "Bruno Giacosa classic. Alluring aromas of wild red cherries, dried rose petals, leather, tar, and noble alpine tannins with great structure.",
      "wineProfile": "Perfect with braised beef short ribs, white truffle risotto, and rich pappardelle al ragù."},
     "Nebbiolo", 2),
    ({"wineName": "Chablis Grand Cru", "wineType": "White", "wineRegion": "Les Clos, Burgundy, France", "wineVint": 2019,
      "wineValue": 120, "pairings": ["Seafood", "Poultry", "Salad", "Cheese"],
      "wineDescription": "Pristine flinty minerality, lemon curd, crushed chalk, and saline freshness. Subtle oak texture with vibrant cool-climate Burgundy tension.",
      "wineProfile": "Flawless with fresh Brittany oysters, butter-poached Maine lobster, scallops, and Dover sole."},
     "Chardonnay", 2),
    ({"wineName": "Dom Pérignon Vintage", "wineType": "Sparkling", "wineRegion": "Champagne, France", "wineVint": 2012,
      "wineValue": 190, "pairings": ["Seafood", "Charcuterie", "Cheese"],
      "wineDescription": "Intense, smoky brioche, toasted almonds, lemon blossom, and a creamy, persistent mousse with vibrant chalky acidity.",
      "wineProfile": "Pairs divinely with Ossetra caviar, Iberico ham, tempura prawns, and triple-crème Brie."},
     "Champagne Blend", 2),
    ({"wineName": "Josh Cellars Craftsman", "wineType": "Red", "wineRegion": "California, USA", "wineVint": 2020,
      "wineValue": 22, "pairings": ["Beef", "Pasta", "Cheese"],
      "wineDescription": "Fruit-forward and approachable. Aromas of ripe black cherries, toasted hazelnut, mocha, and smooth French vanilla oak.",
      "wineProfile": "An everyday favorite with smash burgers, BBQ sliders, pepperoni flatbread, and spaghetti Bolognese."},
     "Cabernet Sauvignon", 4),
    ({"wineName": "Marqués de Riscal Reserva", "wineType": "Red", "wineRegion": "Rioja, Spain", "wineVint": 2018,
      "wineValue": 17, "pairings": ["Lamb", "Charcuterie", "Cheese", "Pasta"],
      "wineDescription": "Classic Rioja complexity. Ripe blackberry, balsamic balsamic nuances, clove, coconut-vanilla from oak aging, and resolved velvety tannins.",
      "wineProfile": "Pair with roasted lamb chops with rosemary, jamón Serrano, chorizo, and Manchego cheese."},
     "Tempranillo", 3),
]


def main():
    config = Config.from_env()
    if config.db_backend != "sqlite":
        print("Refusing to load demo data: DB_BACKEND is not 'sqlite'. Demo data is for local databases only.")
        return 1
    email = os.environ.get("DEMO_EMAIL", "demo@example.com").strip().lower()
    password = os.environ.get("DEMO_PASSWORD", "")
    if len(password) < 8:
        print("Set DEMO_PASSWORD (at least 8 characters) first, for example:")
        print("  Mac/Linux:  DEMO_PASSWORD=choose-one python -m vino.seed_demo")
        print('  Windows:    $env:DEMO_PASSWORD="choose-one"; python -m vino.seed_demo')
        return 1

    config.auto_migrate = True
    app = create_app(config)
    client = app.test_client()

    def call(method, path, body=None):
        resp = client.open(path, method=method, data=json.dumps(body or {}), content_type="application/json")
        data = resp.get_json()
        if resp.status_code >= 400:
            raise SystemExit(f"{method} {path} failed ({resp.status_code}): {data}")
        return data

    signup = client.post("/api/v1/auth/signup", data=json.dumps({
        "userEmail": email, "password": password, "userFname": "Demo", "userLname": "Household"}),
        content_type="application/json")
    if signup.status_code == 409:
        print(f"Demo user {email} already exists. Nothing was changed.")
        return 0
    if signup.status_code != 201:
        raise SystemExit(f"Signup failed ({signup.status_code}): {signup.get_json()}")
    collection_id = signup.get_json()["collections"][0]["collectionId"]

    blends = {b["blendStyle"]: b["blendID"] for b in call("GET", "/api/v1/blends")["blends"]}
    for wine, blend, quantity in DEMO_WINES:
        call("POST", f"/api/v1/collections/{collection_id}/items",
             {"wine": {**wine, "blendID": blends[blend]}, "itemQuantity": quantity})

    value = call("GET", f"/api/v1/collections/{collection_id}/value")
    print(f"Demo household loaded into {config.sqlite_path}")
    print(f"  Email:    {email}")
    print(f"  Password: {password}")
    print(f"  {len(DEMO_WINES)} wines, {value['bottleCount']} bottles, {value['totalValueFormatted']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
