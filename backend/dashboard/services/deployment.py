"""Deployment restrictions independent from account permissions and AI provider."""
import os


def is_rapid():
    environment = os.getenv('DEPLOYMENT_ENV', '').strip().lower()
    if environment:
        return environment == 'rapid'
    # Compatibility with existing installations using the runtime settings file.
    from dashboard.services.env_service import EnvService
    return EnvService.get_config().get('active_environment') == 'rapid'
