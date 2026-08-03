import os
import logging
from pathlib import Path
from flask import Blueprint, jsonify 
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.middleware.proxy_fix import ProxyFix

# Calculate the path to the root .env
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Import Dashboard app factory
from dashboard import create_app as create_dashboard_app
# Import Blueprints
from search.blueprint import search_bp
from drugtox.blueprint import drugtox_bp
from labelcomp.blueprint import labelcomp_bp
from device.blueprint import device_bp
from localquery.blueprint import localquery_bp
from labelquery.blueprint import labelquery_bp
from webtest.blueprint import webtest_bp

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_unified_app():
    # 1. Create the base app using Dashboard's factory
    app = create_dashboard_app()
    
    # Apply ProxyFix to handle X-Forwarded-Proto, X-Forwarded-For, X-Forwarded-Host, etc.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
    
    # 2. Configure CORS for the whole app
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # 3. Register Blueprints with prefixes
    app.register_blueprint(search_bp, url_prefix='/api/search')
    app.register_blueprint(drugtox_bp, url_prefix='/api/drugtox')
    app.register_blueprint(labelcomp_bp, url_prefix='/api/labelcomp')
    app.register_blueprint(device_bp, url_prefix='/api/device')
    app.register_blueprint(localquery_bp, url_prefix='/api/localquery')
    app.register_blueprint(labelquery_bp, url_prefix='/api/labelquery')
    app.register_blueprint(webtest_bp, url_prefix='/api/webtest')
    
    @app.route('/api/check-fdalabel', methods=['POST'])
    def check_fdalabel():
        from dashboard.services.env_service import EnvService
        from flask import current_app
        from dashboard.services.ai_handler import _check_is_internal
        
        label_src = EnvService.get_setting("labeling_source")
        allow_local = current_app.config.get('LOCAL_QUERY', True)
        
        is_internal = _check_is_internal()
        
        # Enforce FDALabel accessibility by labeling_source or internal network presence
        if label_src == "fdalabel" or is_internal:
            fda_accessible = True
            cder_accessible = True
        else:
            fda_accessible = False
            cder_accessible = False

        return jsonify({
            "isInternal": fda_accessible or cder_accessible,
            "fdaAccessible": fda_accessible,
            "cderAccessible": cder_accessible,
            "localAccessible": allow_local,
            "allowLocalQuery": allow_local
        })

    @app.route('/health', methods=['GET'])
    def health():
        return jsonify({"status": "ok"})

    return app

app = create_unified_app()
   

if __name__ == "__main__":
    port = int(os.environ.get("BACKEND_PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    logger.info(f"Starting backend with debug={debug}")
    app.run(host=host, port=port, debug=debug, use_reloader=debug, threaded=True)
