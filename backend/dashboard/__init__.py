import os
from flask import Flask
from dotenv import load_dotenv

from pathlib import Path
from dashboard.config import Config
from database import db, migrate, login_manager, User, Project, Favorite, FavoriteComparison, MeddraSOC, ExaminePrompt

def create_app(config_class=Config):
    env_path = Path(__file__).resolve().parent.parent.parent / '.env'
    load_dotenv(dotenv_path=env_path)
    
    app = Flask(__name__)
    app.config.from_object(config_class)
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

    # Initialize Extensions
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"

    # Register Blueprints
    from dashboard.routes.auth import auth_bp
    from dashboard.routes.main import main_bp
    from dashboard.routes.api import api_bp
    from dashboard.routes.admin import admin_bp

    app.register_blueprint(auth_bp, url_prefix='/api/dashboard/auth')
    app.register_blueprint(main_bp, url_prefix='/api/dashboard')
    app.register_blueprint(api_bp, url_prefix='/api/dashboard')
    app.register_blueprint(admin_bp, url_prefix='/api/dashboard/admin')

    # Ensure data directories exist
    os.makedirs(app.config["DATA_DIR"], exist_ok=True)
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    @login_manager.user_loader
    def load_user(user_id):
        user = User.query.get(int(user_id))
        if user and hasattr(user, 'is_active') and getattr(user, 'is_active') is False:
            return None
        return user

    with app.app_context():
        # Ensure pgvector extension exists before creating tables
        if "postgresql" in app.config.get("SQLALCHEMY_DATABASE_URI", ""):
            import time
            from sqlalchemy.exc import OperationalError
            from sqlalchemy import text
            
            max_retries = 10
            retry_interval = 3
            for attempt in range(1, max_retries + 1):
                try:
                    db.session.execute(text("SELECT 1"))
                    db.session.commit()
                    break
                except OperationalError as e:
                    print(f"Database connection attempt {attempt}/{max_retries} failed (DB starting up?): {e}")
                    db.session.rollback()
                    if attempt == max_retries:
                        raise e
                    time.sleep(retry_interval)

            try:
                db.session.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))
                db.session.execute(text("CREATE SCHEMA IF NOT EXISTS labeling"))
                db.session.commit()
            except Exception as e:
                print(f"Error initializing database extension/schema: {e}")
                db.session.rollback()
        db.create_all()
        ensure_user_schema()
        migrate_projects()
        seed_examine_prompts()
        check_meddra_data()

    return app

def ensure_user_schema():
    """Ensure user table has citext for username and columns are up to date."""
    try:
        from sqlalchemy import text
        dialect = db.engine.dialect.name
        if dialect == 'postgresql':
            db.session.execute(text("CREATE EXTENSION IF NOT EXISTS citext;"))
            db.session.commit()
            
            type_sql = text("""
                SELECT udt_name 
                FROM information_schema.columns 
                WHERE table_name='user' 
                  AND column_name='username' 
                  AND table_schema = current_schema();
            """)
            type_res = db.session.execute(type_sql).fetchone()
            if type_res and type_res[0].lower() != 'citext':
                print("Updating 'username' column in 'user' table to 'citext' type for case-insensitivity...")
                alter_type_sql = text('ALTER TABLE "user" ALTER COLUMN username TYPE citext;')
                db.session.execute(alter_type_sql)
                db.session.commit()
                print("'username' column successfully altered to 'citext'.")
    except Exception as e:
        print(f"Schema check error (citext): {e}")
        db.session.rollback()

def check_meddra_data():
    """Checks if MedDRA tables are populated and warns the user if not."""
    try:
        from database import MeddraSOC
        count = MeddraSOC.query.count()
        if count == 0:
            print("\n" + "!"*60)
            print("WARNING: MedDRA dictionary data is not populated in the database.")
            print("FAERS analysis features will have limited details (N/A for SOC/HLT).")
            print("To fix this, please run:")
            print("    python test/populate_meddra.py")
            print("!"*60 + "\n")
    except Exception as e:
        # Tables might not exist yet if migration hasn't run
        pass

def seed_examine_prompts():
    """Auto-populate the examine_prompts table with default clinical query templates.
    Runs on every startup; upserts built-in prompts by title so changes propagate to existing DBs."""
    try:
        # Deduplicate: for each title keep only the lowest-id row, delete the rest
        all_prompts = ExaminePrompt.query.order_by(ExaminePrompt.id).all()
        seen_titles = set()
        for p in all_prompts:
            if p.title in seen_titles:
                db.session.delete(p)
            else:
                seen_titles.add(p.title)
        db.session.commit()

        defaults = [
            {
                'title': 'Maximum Daily Dose (MDD)',
                'description': 'Identifies the maximum daily dose, dosing ceiling, and any indication-specific caps stated in the labeling.',
                'prompt_text': (
                    "You are a clinical pharmacology expert reviewing an FDA-approved drug labeling document. "
                    "Your task is to identify and clearly state the Maximum Daily Dose (MDD) for this drug.\n\n"
                    "Instructions:\n"
                    "1. Scan Section 2 (Dosage and Administration) and Section 10 (Overdosage) of the label.\n"
                    "2. State the absolute maximum daily dose with units (e.g., mg/day, mcg/day).\n"
                    "3. If different indications have different maximum doses, list each separately with its indication.\n"
                    "4. If maximum dose varies by patient population (e.g., pediatric, renal impairment), note each.\n"
                    "5. End your answer with a verbatim quote from the label that directly states the maximum dose limit. "
                    "Format it as: **Verbatim:** \"[exact quote here]\"\n\n"
                    "IMPORTANT — Tag every MDD value: whenever you state a Maximum Daily Dose number (dose + unit), "
                    "wrap it in <MDD> tags so it can be highlighted in the UI. "
                    "Example: The maximum daily dose is <MDD>400 mg/day</MDD>. "
                    "Apply this tag to every distinct MDD value you report, including population-specific ones.\n\n"
                    "Be concise, use clinical formatting. Do not invent data not present in the label."
                ),
                'display_order': 1,
            },
            {
                'title': 'Boxed Warnings & Contraindications',
                'description': 'Extracts all boxed warnings, contraindications, and the clinical rationale behind each.',
                'prompt_text': (
                    "You are a clinical pharmacology expert reviewing an FDA-approved drug labeling document. "
                    "Your task is to extract and summarize the drug's safety profile from its most critical sections.\n\n"
                    "Instructions:\n"
                    "1. List all Boxed Warning items verbatim (Section 5 / Highlights), if any.\n"
                    "2. List all Contraindications (Section 4) as a bulleted list.\n"
                    "3. For each contraindication, briefly state the clinical rationale (why it is contraindicated).\n"
                    "4. Note any patient populations specifically mentioned as contraindicated.\n\n"
                    "Use markdown formatting: bold warning titles, bullet points for each item. Be concise and factual."
                ),
                'display_order': 2,
            },
            {
                'title': 'Special Population Dose Adjustments',
                'description': 'Summarizes dosing adjustments for renal/hepatic impairment, pregnancy, pediatric, and geriatric populations.',
                'prompt_text': (
                    "You are a clinical pharmacology expert reviewing an FDA-approved drug labeling document. "
                    "Your task is to summarize all dose adjustment recommendations for special populations.\n\n"
                    "Instructions:\n"
                    "Scan Section 2 (Dosage and Administration) and Section 8 (Use in Specific Populations). "
                    "For each of the following populations, state whether dose adjustment is required, recommended, or not applicable. "
                    "If adjustment is required, state the specific recommendation:\n"
                    "- Renal Impairment (mild/moderate/severe, ESRD)\n"
                    "- Hepatic Impairment (Child-Pugh A/B/C)\n"
                    "- Pediatric Use\n"
                    "- Geriatric Use\n"
                    "- Pregnancy & Lactation\n\n"
                    "Format as a structured table if possible. State 'Not addressed in labeling' if information is absent."
                ),
                'display_order': 3,
            },
            {
                'title': 'Drug Interactions & CYP Metabolism',
                'description': 'Identifies major drug-drug interactions and the CYP enzyme profile for this drug.',
                'prompt_text': (
                    "You are a clinical pharmacology expert reviewing an FDA-approved drug labeling document. "
                    "Your task is to summarize the drug interaction profile.\n\n"
                    "Instructions:\n"
                    "1. State the primary CYP enzymes responsible for metabolism of this drug (substrate, inducer, or inhibitor).\n"
                    "2. List major drug-drug interactions from Section 7 (Drug Interactions), categorized as:\n"
                    "   - **Contraindicated combinations** (do not use together)\n"
                    "   - **Requires dose adjustment or monitoring**\n"
                    "   - **Informational** (use with caution)\n"
                    "3. Mention any significant food/beverage interactions (e.g., grapefruit juice).\n\n"
                    "Be specific. Include drug names and the mechanism of interaction where stated in the label."
                ),
                'display_order': 4,
            },
        ]
        inserted = updated = 0
        for p in defaults:
            existing = ExaminePrompt.query.filter_by(title=p['title']).first()
            if existing:
                existing.description  = p['description']
                existing.prompt_text  = p['prompt_text']
                existing.display_order = p['display_order']
                updated += 1
            else:
                db.session.add(ExaminePrompt(**p))
                inserted += 1
        db.session.commit()
        print(f"[Examine] Examine prompts: {inserted} inserted, {updated} updated.")
    except Exception as e:
        print(f"[Examine] Failed to seed prompts: {e}")
        db.session.rollback()


def migrate_projects():
    """Ensure all users have a 'Favorite' Project and move orphaned items there."""
    try:
        users = User.query.all()
        for user in users:
            # 1. Rename old "Default Project" or "Not Grouped" if exists
            old_default = Project.query.filter(
                (Project.owner_id == user.id) & 
                ((Project.title == "Default Project") | (Project.title == "Not Grouped"))
            ).first()
            
            if old_default:
                old_default.title = "Favorite"
                if old_default.display_order is None:
                    old_default.display_order = 0
            
            # 2. Check/Create "Favorite" project
            default_proj = Project.query.filter_by(owner_id=user.id, title="Favorite").first()
            if not default_proj:
                default_proj = Project(title="Favorite", description="My favorite drug labels", owner_id=user.id, display_order=0)
                db.session.add(default_proj)
                db.session.commit() # Commit to get ID
            
            # Move orphaned Favorites
            orphaned_favs = Favorite.query.filter_by(user_id=user.id, project_id=None).all()
            for fav in orphaned_favs:
                fav.project_id = default_proj.id
                
            # Move orphaned Comparisons
            orphaned_comps = FavoriteComparison.query.filter_by(user_id=user.id, project_id=None).all()
            for comp in orphaned_comps:
                comp.project_id = default_proj.id
        
        db.session.commit()
    except Exception as e:
        print(f"Migration error: {e}")
        db.session.rollback()
