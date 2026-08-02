import os
import json
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

CONFIG_PATH = '/data/config/env_settings.json'

DEFAULT_CONFIG = {
    "labeling_source": "local",      # 'local' or 'fdalabel'
    "postgres_db": "local",          # 'local' or 'external'
    "external_pg_host": "",
    "external_pg_user": "",
    "external_pg_password": "",
    "external_pg_database": "",
    "oracle_db_env": "tst",          # 'dev' or 'tst'
    "ai_model_provider": os.getenv("DEFAULT_AI_MODEL", "elsa"),   # 'gemini', 'elsa', 'customized'
    "custom_llm_url": "",
    "custom_llm_key": ""
}

class EnvService:
    @staticmethod
    def get_config():
        """Reads the environment config, returning defaults if not found."""
        if not os.path.exists(CONFIG_PATH):
            default_cfg = DEFAULT_CONFIG.copy()
            default_cfg["ai_model_provider"] = os.getenv("DEFAULT_AI_MODEL", "elsa")
            return default_cfg
        
        try:
            with open(CONFIG_PATH, 'r') as f:
                config = json.load(f)
                
                # Migrate old "active_environment" formats gracefully to new schema if present
                if "active_environment" in config:
                    env = config.pop("active_environment")
                    if env == "fda":
                        config.update({"labeling_source": "fdalabel", "postgres_db": "local", "ai_model_provider": "elsa"})
                    elif env == "rapid":
                        config.update({"labeling_source": "fdalabel", "postgres_db": "external", "ai_model_provider": "rapid"})
                    else:
                        config.update({"labeling_source": "local", "postgres_db": "local", "ai_model_provider": "gemini"})

                # Fill any missing keys with defaults
                for k, v in DEFAULT_CONFIG.items():
                    if k not in config:
                        config[k] = v
                
                # ALWAYS force ai_model_provider to the env variable value
                config["ai_model_provider"] = os.getenv("DEFAULT_AI_MODEL", "elsa")
                        
                return config
        except Exception as e:
            logger.error(f"Failed to read env config: {e}")
            default_cfg = DEFAULT_CONFIG.copy()
            default_cfg["ai_model_provider"] = os.getenv("DEFAULT_AI_MODEL", "elsa")
            return default_cfg
            
    @staticmethod
    def get_setting(key):
        """Returns a specific setting from the config."""
        if key == "ai_model_provider":
            return os.getenv("DEFAULT_AI_MODEL", "elsa")
        return EnvService.get_config().get(key, DEFAULT_CONFIG.get(key))

    @staticmethod
    def set_config(new_config):
        """Updates the full config and writes to disk."""
        config = EnvService.get_config()
        
        for k in DEFAULT_CONFIG.keys():
            if k in new_config:
                config[k] = new_config[k]
        
        # Ensure dir exists
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=4)
        
        logger.info(f"Environment successfully updated to: {config}")
        return config
