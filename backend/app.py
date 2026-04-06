from flask import Flask, jsonify, request
from flask_cors import CORS


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.get("/api/health")
    def health_check():
        return jsonify(status="ok", service="wealth-horizon-backend")

    @app.get("/api/meta")
    def meta():
        return jsonify(
            message="Python backend scaffold is ready.",
            version="0.1.0",
            next_step="Add simulation logic when the UI contract is finalized.",
        )

    @app.post("/api/simulation/placeholder")
    def simulation_placeholder():
        payload = request.get_json(silent=True) or {}
        return jsonify(
            message="Placeholder response only.",
            received_keys=sorted(payload.keys()),
        )

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)