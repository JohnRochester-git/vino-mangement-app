"""API blueprints. Every route lives under /api/v1."""


def register_blueprints(app):
    from ..auth import bp as auth_bp
    from .collections import bp as collections_bp
    from .consumption import bp as consumption_bp
    from .csv_io import bp as csv_bp
    from .insights import bp as insights_bp
    from .items import bp as items_bp
    from .wines import bp as wines_bp
    from .wishlist import bp as wishlist_bp

    for blueprint in (auth_bp, collections_bp, wines_bp, items_bp, consumption_bp, insights_bp,
                      csv_bp, wishlist_bp):
        app.register_blueprint(blueprint, url_prefix="/api/v1")
