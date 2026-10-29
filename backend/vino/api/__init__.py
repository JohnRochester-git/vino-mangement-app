"""API blueprints. Every route lives under /api/v1."""


def register_blueprints(app):
    from ..auth import bp as auth_bp
    from .collections import bp as collections_bp
    from .items import bp as items_bp
    from .wines import bp as wines_bp

    for blueprint in (auth_bp, collections_bp, wines_bp, items_bp):
        app.register_blueprint(blueprint, url_prefix="/api/v1")
