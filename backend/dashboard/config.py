import os
from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).resolve().parent.parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'afd-psw-prod')
    SESSION_COOKIE_PATH = '/'

    CELERY_BROKER_URL = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    CELERY_RESULT_BACKEND = os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')

    OPENFDA_API_KEY=os.getenv('OPENFDA_API_KEY','')

    LLM_URL=os.getenv('LLM_URL','')
    LLM_KEY=os.getenv('LLM_KEY','')
    LLM_MODEL=os.getenv('LLM_MODEL','')

    # Gemini Models
    PRIMARY_MODEL_ID = os.getenv('GEMINI_MODEL', 'gemini-3.5-flash-lite')
    FALLBACK_MODEL_ID = os.getenv('GEMINI_FALLBACK_MODEL', 'gemini-2.5-pro')

    ELSA_API_NAME=os.getenv('ELSA_API_NAME','')
    ELSA_API_KEY=os.getenv('ELSA_API_KEY','')
    ELSA_MODEL_ID=os.getenv('ELSA_MODEL_ID','')
    ELSA_MODEL_NAME=os.getenv('ELSA_MODEL_NAME','')

    # Production Database Configuration
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        # Fallback: construct from individual variables if they exist
        pg_user = os.getenv("PG_USERNAME") or os.getenv("PG_USER")
        pg_password = os.getenv("PG_PASSWORD")
        pg_host = os.getenv("PG_HOST")
        pg_port = os.getenv("PG_PORT") or "5432"
        pg_database = os.getenv("PG_DATABASE") or os.getenv("PG_DB")
        if pg_user and pg_password and pg_host and pg_database:
            DATABASE_URL = f"postgresql://{pg_user}:{pg_password}@{pg_host}:{pg_port}/{pg_database}"

    if not DATABASE_URL:
        raise ValueError("DATABASE_URL (or PG_USERNAME, PG_PASSWORD, PG_HOST, PG_DATABASE) must be set in .env for PostgreSQL")
    
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

    # If running outside Docker container, automatically map container DB host 'db' to 'localhost'
    if not os.path.exists('/.dockerenv'):
        if '@db:' in DATABASE_URL:
            DATABASE_URL = DATABASE_URL.replace('@db:', '@localhost:')
        elif '@db/' in DATABASE_URL:
            DATABASE_URL = DATABASE_URL.replace('@db/', '@localhost/')
        elif 'db:5432' in DATABASE_URL:
            DATABASE_URL = DATABASE_URL.replace('db:5432', 'localhost:5432')

    # Paths - Use project root as base, but check for Docker /data mount
    PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
    
    if os.path.exists('/data'):
        DATA_DIR = Path('/data')
    else:
        DATA_DIR = PROJECT_ROOT / 'data'
    
    try:
        with open('/data/config/env_settings.json', 'r') as f:
            env_config = __import__('json').load(f)
            is_external_pg = env_config.get("postgres_db") == "external" or env_config.get("active_environment") == "rapid"
            if is_external_pg:
                pg_host = env_config.get("external_pg_host")
                pg_user = env_config.get("external_pg_user")
                pg_password = env_config.get("external_pg_password")
                pg_database = env_config.get("external_pg_database")
                
                if pg_host:
                    if pg_host.startswith("postgresql://") or pg_host.startswith("postgres://"):
                        DATABASE_URL = pg_host
                    elif pg_user and pg_password and pg_database:
                        DATABASE_URL = f"postgresql://{pg_user}:{pg_password}@{pg_host}/{pg_database}"
                else:
                    rapid_url = os.getenv("RAPID_PG_URL")
                    if rapid_url:
                        DATABASE_URL = rapid_url
    except Exception:
        pass

    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 3600,
        'pool_size': int(os.getenv('DB_POOL_SIZE', 20)),
        'max_overflow': int(os.getenv('DB_MAX_OVERFLOW', 40)),
    }
    
    UPLOAD_FOLDER = os.path.join(DATA_DIR, 'uploads')
    ANNOTATIONS_FILE = os.path.join(DATA_DIR, 'annotations.json')

    # Internal FDALabel DB Configuration
    # Modes: 'POSTGRES' (Local/Production Postgres), 'ORACLE' (Internal)
    LABEL_DB = os.getenv('LABEL_DB', 'POSTGRES').upper() 
    
    LOCAL_QUERY = os.getenv('LOCAL_QUERY', 'True').lower() == 'true'
    
    # Path/DSN for Labeling DB
    POSTGRES_LABEL_DSN = DATABASE_URL # Shared DB, different schema ('labeling')
    
    SPL_STORAGE_DIR = os.path.join(DATA_DIR, 'spl_storage')
    SPL_STORAGE_DIR_ARCHIVED = os.path.join(DATA_DIR, 'spl_storage_archived')

    FDALabel_HOST = os.getenv('FDALabel_HOST') or os.getenv('FDALabel_SERV') or 'ncsvmscidevl03.fda.gov'
    FDALabel_PORT = os.getenv('FDALabel_PORT', '1521')
    FDALabel_SERVICE = os.getenv('FDALabel_SERVICE') or os.getenv('FDALabel_APP') or 'scidevl3'
    FDALabel_USER = os.getenv('FDALabel_USER', 'lwu')
    FDALabel_PASSWORD = os.getenv('FDALabel_PASSWORD') or os.getenv('FDALabel_PSW')
    FDALabel_PSW = FDALabel_PASSWORD

    FDALABEL_HOST = FDALabel_HOST
    FDALABEL_PORT = FDALabel_PORT
    FDALABEL_SERVICE = FDALabel_SERVICE
    FDALABEL_USER = FDALabel_USER
    FDALABEL_PASSWORD = FDALabel_PASSWORD
    FDALABEL_PSW = FDALabel_PSW

    # Frontend base path for redirects
    FRONTEND_BASE_PATH = os.getenv('FRONTEND_BASE_PATH', '/askfdalabel').rstrip('/')
