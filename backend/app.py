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
from chemsearch.blueprint import chemsearch_bp

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_unified_app():
    # 1. Create the base app using Dashboard's factory
    app = create_dashboard_app()
    
    # Apply ProxyFix to handle X-Forwarded-Proto, X-Forwarded-For, X-Forwarded-Host, etc.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
    
    # 2. Configure CORS for the whole app
    cors_origins = app.config.get('CORS_ORIGINS', '*')
    CORS(app, resources={r"/api/*": {"origins": cors_origins}}, supports_credentials=True)

    # 3. Register Blueprints with prefixes
    app.register_blueprint(search_bp, url_prefix='/api/search')
    app.register_blueprint(drugtox_bp, url_prefix='/api/drugtox')
    app.register_blueprint(labelcomp_bp, url_prefix='/api/labelcomp')
    app.register_blueprint(device_bp, url_prefix='/api/device')
    app.register_blueprint(localquery_bp, url_prefix='/api/localquery')
    app.register_blueprint(labelquery_bp, url_prefix='/api/labelquery')
    app.register_blueprint(webtest_bp, url_prefix='/api/webtest')
    app.register_blueprint(chemsearch_bp, url_prefix='/api/chemsearch')
    
    # 4. Security Headers Middleware
    @app.after_request
    def set_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
        
        # Enable HSTS if HTTPS is active
        from flask import request
        if request.is_secure or request.headers.get('X-Forwarded-Proto', '').lower() == 'https':
            response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
            
        return response

    # 5. Database Session Teardown Safety
    @app.teardown_appcontext
    def shutdown_session(exception=None):
        from database import db
        try:
            if exception:
                db.session.rollback()
            db.session.remove()
        except Exception as e:
            logger.debug(f"Error during db session teardown: {e}")

    # 6. Centralized Error Handlers
    @app.errorhandler(400)
    def bad_request_error(e):
        return jsonify({'error': 'Bad Request', 'message': getattr(e, 'description', str(e))}), 400

    @app.errorhandler(401)
    def unauthorized_error(e):
        return jsonify({'error': 'Unauthorized', 'message': 'Authentication required.'}), 401

    @app.errorhandler(403)
    def forbidden_error(e):
        return jsonify({'error': 'Forbidden', 'message': 'Access forbidden.'}), 403

    @app.errorhandler(404)
    def not_found_error(e):
        return jsonify({'error': 'Not Found', 'message': 'The requested resource was not found.'}), 404

    @app.errorhandler(405)
    def method_not_allowed_error(e):
        return jsonify({'error': 'Method Not Allowed', 'message': 'HTTP method is not allowed for this endpoint.'}), 405

    @app.errorhandler(429)
    def ratelimit_error(e):
        return jsonify({'error': 'Too Many Requests', 'message': getattr(e, 'description', 'Rate limit exceeded.')}), 429

    @app.errorhandler(500)
    def internal_server_error(e):
        import uuid
        error_id = str(uuid.uuid4())[:8]
        logger.error(f"Internal Server Error [ref: {error_id}]: {e}", exc_info=True)
        return jsonify({
            'error': 'Internal Server Error',
            'message': 'An unexpected error occurred. Please contact support or try again.',
            'error_ref': error_id
        }), 500

    @app.route('/api/check-fdalabel', methods=['POST'])
    def check_fdalabel():
        from flask import current_app
        allow_local = current_app.config.get('LOCAL_QUERY', True)
        elsa_api = (os.environ.get('ELSA_API_NAME') or current_app.config.get('ELSA_API_NAME') or '').strip()
        has_elsa = bool(elsa_api)
        
        return jsonify({
            "isInternal": has_elsa,
            "fdaAccessible": has_elsa,
            "cderAccessible": has_elsa,
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
