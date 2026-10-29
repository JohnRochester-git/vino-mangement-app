"""API blueprints. Every route lives under /api/v1."""

BLUEPRINTS = []


def register_blueprints(app):
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint, url_prefix="/api/v1")
