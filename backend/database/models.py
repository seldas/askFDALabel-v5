from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from .extensions import db
from sqlalchemy.dialects.postgresql import CITEXT

# --- Identity Models ---

project_users = db.Table('project_users',
    db.Column('project_id', db.Integer, db.ForeignKey('project.id'), primary_key=True),
    db.Column('user_id', db.Integer, db.ForeignKey('user.id'), primary_key=True)
)

class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    share_code = db.Column(db.String(36), unique=True)
    display_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    owner = db.relationship('User', backref=db.backref('owned_projects', lazy=True), foreign_keys=[owner_id])
    members = db.relationship('User', secondary=project_users, lazy='subquery',
        backref=db.backref('shared_projects', lazy=True))
    
    favorites = db.relationship('Favorite', backref='project', lazy=True, cascade="all, delete-orphan")
    comparisons = db.relationship('FavoriteComparison', backref='project', lazy=True, cascade="all, delete-orphan")

import os

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(CITEXT, unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    
    # AI Preferences
    is_admin = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True, server_default='true')

    @staticmethod
    def _default_ai_provider():
        default_model = os.getenv("DEFAULT_AI_MODEL")
        if default_model:
            return default_model
        try:
            from dashboard.services.ai_handler import _check_is_internal
            return 'elsa' if _check_is_internal() else 'gemini'
        except Exception:
            return 'gemini'

    ai_provider = db.Column(db.String(20), default=_default_ai_provider)
    custom_gemini_key = db.Column(db.String(255), nullable=True)
    openai_api_key = db.Column(db.String(255), nullable=True)
    openai_base_url = db.Column(db.String(255), nullable=True)
    openai_model_name = db.Column(db.String(100), nullable=True)
    ai_settings = db.Column(db.Text, nullable=True)
    
    favorites = db.relationship('Favorite', backref='user', lazy=True)
    comparisons = db.relationship('FavoriteComparison', backref='user', lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256')

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

# --- User Content Models ---

class SearchHistory(db.Model):
    __tablename__ = 'search_history'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    chat_data = db.Column(db.Text, nullable=False) # JSON string
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('search_histories', lazy=True, cascade="all, delete-orphan"))

class UserQueryHistory(db.Model):
    __tablename__ = 'user_query_history'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    query_title = db.Column(db.String(500), nullable=False)
    query_link = db.Column(db.Text, nullable=False)
    query_json = db.Column(db.Text, nullable=True) # JSON string of query structure
    result_count = db.Column(db.Integer, default=0)
    target_db = db.Column(db.String(50), default='oracle')
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('query_histories', lazy=True, cascade="all, delete-orphan"))

class Favorite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    set_id = db.Column(db.String(100), nullable=False)
    brand_name = db.Column(db.Text)
    generic_name = db.Column(db.Text)
    manufacturer_name = db.Column(db.Text)
    market_category = db.Column(db.Text)
    application_number = db.Column(db.Text)
    ndc = db.Column(db.Text)
    effective_time = db.Column(db.String(100))
    
    # Missing columns for full analysis
    active_ingredients = db.Column(db.Text)
    labeling_type = db.Column(db.Text)
    dosage_forms = db.Column(db.Text)
    routes = db.Column(db.Text)
    epc = db.Column(db.Text)
    fdalabel_link = db.Column(db.Text)
    dailymed_spl_link = db.Column(db.Text)
    dailymed_pdf_link = db.Column(db.Text)
    product_type = db.Column(db.Text)
    label_format = db.Column(db.Text)
    source = db.Column(db.String(50))
    tag = db.Column(db.String(100), nullable=True)

    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class Annotation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    set_id = db.Column(db.String(100), nullable=False)
    section_number = db.Column(db.String(50), nullable=False)
    question = db.Column(db.Text, nullable=False)
    answer = db.Column(db.Text, nullable=False)
    keywords = db.Column(db.Text) # Stored as JSON string
    is_public = db.Column(db.Boolean, default=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class FavoriteComparison(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    set_ids = db.Column(db.Text, nullable=False) # JSON string of list of set_ids
    title = db.Column(db.String(255), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class LabelAnnotation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    set_id = db.Column(db.String(100), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    section_id = db.Column(db.String(100), nullable=False)
    start_offset = db.Column(db.Integer, nullable=False)
    end_offset = db.Column(db.Integer, nullable=False)
    selected_text = db.Column(db.Text, nullable=False)
    annotation_type = db.Column(db.String(20), nullable=False)
    color = db.Column(db.String(20))
    comment = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    user = db.relationship('User', backref=db.backref('label_annotations', lazy=True))
    project = db.relationship('Project', backref=db.backref('label_annotations', lazy=True, cascade="all, delete-orphan"))

class ComparisonSummary(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    set_ids_hash = db.Column(db.String(64), unique=True, nullable=False)
    set_ids = db.Column(db.Text, nullable=False)
    summary_content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

# --- Pharmacology / Toxicity Models ---

class DrugToxicity(db.Model):
    __tablename__ = 'drug_toxicity'
    id = db.Column(db.Integer, primary_key=True)
    SETID = db.Column(db.String(100), index=True)
    Toxicity_Class = db.Column(db.String(50), index=True)
    Tox_Type = db.Column(db.String(50), index=True)
    is_historical = db.Column(db.Integer, default=0)
    Update_Notes = db.Column(db.Text)
    AI_Summary = db.Column(db.Text)
    Evidence = db.Column(db.Text)
    endpoint = db.Column(db.String(50))
    AI_Model = db.Column(db.String(100))
    Assessment_Date = db.Column(db.String(50))


class DiliRo2Reference(db.Model):
    """Fixed reference drugs for the Rule-of-Two (DILI) quadrant plot.

    Seeded from backend/database/seed/dili_ro2_reference.csv — see the README
    there for per-column provenance. alogp is computed at import by RDKit from
    smiles, so reference points and the drug under assessment always share one
    logP implementation.
    """
    __tablename__ = 'dili_ro2_reference'
    id = db.Column(db.Integer, primary_key=True)
    drug_name = db.Column(db.String(120), unique=True, nullable=False, index=True)
    dilirank_compound = db.Column(db.String(200))
    dili_concern = db.Column(db.String(40), index=True)
    dili_severity_class = db.Column(db.String(10))
    max_daily_dose_mg = db.Column(db.Float, nullable=False)
    dose_basis = db.Column(db.String(40))
    dose_note = db.Column(db.Text)
    dose_review_status = db.Column(db.String(40), default='needs-sme-review')
    route = db.Column(db.String(40), default='oral')
    pubchem_cid = db.Column(db.String(30))
    inchikey = db.Column(db.String(30), index=True)
    smiles = db.Column(db.Text)
    mol_weight = db.Column(db.Float)
    pubchem_xlogp3 = db.Column(db.Float)
    # Computed at import from smiles via rdkit Crippen.MolLogP. Null when RDKit
    # is unavailable — the tool must then fall back to pubchem_xlogp3 and say so.
    alogp = db.Column(db.Float, index=True)
    alogp_method = db.Column(db.String(60))


class ProjectAeReport(db.Model):
    __tablename__ = 'project_ae_report'
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    target_pt = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), default='pending') # pending, processing, completed, failed
    progress = db.Column(db.Integer, default=0) # 0 to 100
    total_labels = db.Column(db.Integer, default=0)
    processed_labels = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime)

    project = db.relationship('Project', backref=db.backref('ae_reports', lazy=True, cascade="all, delete-orphan"))
    details = db.relationship('ProjectAeReportDetail', backref='report', cascade="all, delete-orphan")

class ProjectAeReportDetail(db.Model):
    __tablename__ = 'project_ae_report_detail'
    id = db.Column(db.Integer, primary_key=True)
    report_id = db.Column(db.Integer, db.ForeignKey('project_ae_report.id'), nullable=False)
    set_id = db.Column(db.String(100), nullable=False)
    brand_name = db.Column(db.String(255))
    generic_name = db.Column(db.String(255))
    is_labeled = db.Column(db.Boolean, default=False)
    found_sections = db.Column(db.Text) # JSON string: [{"section": "Warnings", "snippet": "..."}]
    faers_count = db.Column(db.Integer, default=0)
    faers_1yr_count = db.Column(db.Integer, default=0)
    faers_5yr_count = db.Column(db.Integer, default=0)
    faers_serious_count = db.Column(db.Integer, default=0)

# --- MedDRA Models ---

class MeddraSOC(db.Model):
    __tablename__ = 'meddra_soc'
    soc_code = db.Column(db.Integer, primary_key=True)
    soc_name = db.Column(db.String(255), nullable=False)
    soc_abbrev = db.Column(db.String(50))
    soc_whoart_code = db.Column(db.String(20))
    soc_harts_code = db.Column(db.Integer)
    soc_costart_code = db.Column(db.String(20))
    soc_icd9_code = db.Column(db.String(20))
    soc_icd9cm_code = db.Column(db.String(20))
    soc_icd10_code = db.Column(db.String(20))
    soc_currency = db.Column(db.String(1))

class MeddraHLGT(db.Model):
    __tablename__ = 'meddra_hlgt'
    hlgt_code = db.Column(db.Integer, primary_key=True)
    hlgt_name = db.Column(db.String(255), nullable=False)
    hlgt_whoart_code = db.Column(db.String(20))
    hlgt_harts_code = db.Column(db.Integer)
    hlgt_costart_code = db.Column(db.String(20))
    hlgt_icd9_code = db.Column(db.String(20))
    hlgt_icd9cm_code = db.Column(db.String(20))
    hlgt_icd10_code = db.Column(db.String(20))
    hlgt_currency = db.Column(db.String(1))

class MeddraHLT(db.Model):
    __tablename__ = 'meddra_hlt'
    hlt_code = db.Column(db.Integer, primary_key=True)
    hlt_name = db.Column(db.String(255), nullable=False)
    hlt_whoart_code = db.Column(db.String(20))
    hlt_harts_code = db.Column(db.Integer)
    hlt_costart_code = db.Column(db.String(20))
    hlt_icd9_code = db.Column(db.String(20))
    hlt_icd9cm_code = db.Column(db.String(20))
    hlt_icd10_code = db.Column(db.String(20))
    hlt_currency = db.Column(db.String(1))

class MeddraPT(db.Model):
    __tablename__ = 'meddra_pt'
    pt_code = db.Column(db.Integer, primary_key=True)
    pt_name = db.Column(db.String(255), nullable=False)
    null_field = db.Column(db.String(1))
    pt_soc_code = db.Column(db.Integer)
    pt_whoart_code = db.Column(db.String(20))
    pt_harts_code = db.Column(db.Integer)
    pt_costart_code = db.Column(db.String(20))
    pt_icd9_code = db.Column(db.String(20))
    pt_icd9cm_code = db.Column(db.String(20))
    pt_icd10_code = db.Column(db.String(20))
    pt_currency = db.Column(db.String(1))

class MeddraLLT(db.Model):
    __tablename__ = 'meddra_llt'
    llt_code = db.Column(db.Integer, primary_key=True)
    llt_name = db.Column(db.String(255), nullable=False)
    pt_code = db.Column(db.Integer, db.ForeignKey('meddra_pt.pt_code'))
    llt_whoart_code = db.Column(db.String(20))
    llt_harts_code = db.Column(db.Integer)
    llt_costart_code = db.Column(db.String(20))
    llt_icd9_code = db.Column(db.String(20))
    llt_icd9cm_code = db.Column(db.String(20))
    llt_icd10_code = db.Column(db.String(20))
    llt_currency = db.Column(db.String(1))
    
    pt = db.relationship('MeddraPT', backref='llts')

class MeddraMDHIER(db.Model):
    __tablename__ = 'meddra_mdhier'
    id = db.Column(db.Integer, primary_key=True)
    pt_code = db.Column(db.Integer, db.ForeignKey('meddra_pt.pt_code'), nullable=False)
    hlt_code = db.Column(db.Integer, db.ForeignKey('meddra_hlt.hlt_code'), nullable=False)
    hlgt_code = db.Column(db.Integer, db.ForeignKey('meddra_hlgt.hlgt_code'), nullable=False)
    soc_code = db.Column(db.Integer, db.ForeignKey('meddra_soc.soc_code'), nullable=False)
    pt_name = db.Column(db.String(255))
    hlt_name = db.Column(db.String(255))
    hlgt_name = db.Column(db.String(255))
    soc_name = db.Column(db.String(255))
    soc_abbrev = db.Column(db.String(50))
    null_field = db.Column(db.String(1))
    pt_soc_code = db.Column(db.Integer)
    primary_soc_fg = db.Column(db.String(1))

    __table_args__ = (
        db.Index('idx_mdhier_pt', 'pt_code'),
        db.Index('idx_mdhier_soc', 'soc_code'),
    )

class MeddraSMQList(db.Model):
    __tablename__ = 'meddra_smq_list'
    smq_code = db.Column(db.Integer, primary_key=True)
    smq_name = db.Column(db.Text, nullable=False)
    smq_level = db.Column(db.Integer)
    smq_description = db.Column(db.Text)
    smq_source = db.Column(db.Text)
    smq_note = db.Column(db.Text)
    meddra_version = db.Column(db.String(10))
    status = db.Column(db.String(1))
    smq_algorithm = db.Column(db.Text)

class MeddraSMQContent(db.Model):
    __tablename__ = 'meddra_smq_content'
    id = db.Column(db.Integer, primary_key=True)
    smq_code = db.Column(db.Integer, db.ForeignKey('meddra_smq_list.smq_code'), nullable=False)
    term_code = db.Column(db.Integer, nullable=False)
    term_level = db.Column(db.Integer, nullable=False)
    term_scope = db.Column(db.Integer)
    term_category = db.Column(db.String(1))
    term_weight = db.Column(db.Integer)
    term_status = db.Column(db.String(1))
    term_addition_version = db.Column(db.String(10))
    term_last_modified_version = db.Column(db.String(10))

    __table_args__ = (
        db.Index('idx_smq_content_smq', 'smq_code'),
        db.Index('idx_smq_content_term', 'term_code'),
    )

# --- PGx Models ---

class PgxBiomarker(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    drug_name = db.Column(db.String(255), nullable=False)
    therapeutic_area = db.Column(db.String(255))
    biomarker_name = db.Column(db.String(255), nullable=False)
    labeling_sections = db.Column(db.Text)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class PgxSynonym(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    term = db.Column(db.String(255), unique=True, nullable=False, index=True)
    normalized_name = db.Column(db.String(255), nullable=False)

class PgxAssessment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    set_id = db.Column(db.String(100), unique=True, nullable=False)
    report_content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

# --- AI Assessment Models ---

class AeAiAssessment(db.Model):
    __tablename__ = 'ae_ai_assessment'
    id = db.Column(db.Integer, primary_key=True)
    set_id = db.Column(db.String(100), nullable=False, index=True)
    drug_name = db.Column(db.String(255), nullable=False)
    result_json = db.Column(db.Text, nullable=False) # Store as JSON string
    min_count = db.Column(db.Integer, default=10)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)



# --- Drug Labeling Models (in 'labeling' schema) ---

class DrugLabel(db.Model):
    __tablename__ = 'sum_spl'
    __table_args__ = {'schema': 'labeling'}
    
    spl_id = db.Column(db.String(100), primary_key=True)
    set_id = db.Column(db.String(100), index=True)
    product_names = db.Column(db.Text)
    generic_names = db.Column(db.Text)
    manufacturer = db.Column(db.Text)
    appr_num = db.Column(db.Text)
    active_ingredients = db.Column(db.Text)
    market_categories = db.Column(db.Text)
    doc_type = db.Column(db.Text)
    routes = db.Column(db.Text)
    dosage_forms = db.Column(db.Text)
    epc = db.Column(db.Text)
    ndc_codes = db.Column(db.Text)
    revised_date = db.Column(db.String(20))
    effective_time_raw = db.Column(db.String(50))
    initial_approval_year = db.Column(db.Integer)
    is_rld = db.Column(db.Integer, default=0)
    is_rs = db.Column(db.Integer, default=0)
    local_path = db.Column(db.Text)

class ActiveIngredientMap(db.Model):
    __tablename__ = 'active_ingredients_map'
    __table_args__ = {'schema': 'labeling'}

    id = db.Column(db.Integer, db.Identity(start=1, cycle=True), primary_key=True)
    spl_id = db.Column(db.String(100), db.ForeignKey('labeling.sum_spl.spl_id', ondelete='CASCADE'), index=True)
    substance_name = db.Column(db.Text)
    unii = db.Column(db.Text)
    is_active = db.Column(db.Integer)
class OrangeBook(db.Model):
    __tablename__ = 'orange_book'
    id = db.Column(db.Integer, primary_key=True)
    ingredient = db.Column(db.String(500))
    df_route = db.Column(db.String(500))
    trade_name = db.Column(db.String(500))
    applicant = db.Column(db.String(255))
    strength = db.Column(db.String(500))
    appl_type = db.Column(db.String(10)) # N or A
    appl_no = db.Column(db.String(20), index=True)
    product_no = db.Column(db.String(10))
    te_code = db.Column(db.String(50))
    approval_date = db.Column(db.String(50))
    rld = db.Column(db.String(10)) # Yes or No
    rs = db.Column(db.String(10))  # Yes or No
    type = db.Column(db.String(20)) # RX, OTC, DISCN
    applicant_full_name = db.Column(db.String(500))

class SystemTask(db.Model):
    __tablename__ = 'system_tasks'
    id = db.Column(db.Integer, primary_key=True)
    task_type = db.Column(db.String(50), nullable=False) # 'labeling', 'ae_report', etc.
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=True)
    status = db.Column(db.String(20), default='pending') # pending, processing, completed, failed
    progress = db.Column(db.Integer, default=0) # 0 to 100
    message = db.Column(db.String(255))
    error_details = db.Column(db.Text)
    result_data = db.Column(db.Text) # JSON string for any task-specific output
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = db.Column(db.DateTime)

    user = db.relationship('User', backref=db.backref('tasks', lazy=True))
    project = db.relationship('Project', backref=db.backref('tasks', lazy=True))

class LabelMeddraProfile(db.Model):
    __tablename__ = 'label_meddra_profiles'
    id = db.Column(db.Integer, primary_key=True)
    set_id = db.Column(db.String(100), index=True, nullable=False)
    section_loinc = db.Column(db.String(50), index=True, nullable=False)
    terms = db.Column(db.Text) # Stored as a comma-separated or JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('set_id', 'section_loinc', name='_set_section_uc'),
    )

class TokenUsage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True, index=True)
    model_name = db.Column(db.String(100), nullable=False)
    input_tokens = db.Column(db.Integer, default=0)
    output_tokens = db.Column(db.Integer, default=0)
    total_tokens = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user = db.relationship('User', backref=db.backref('token_usages', lazy='dynamic'))

# --- Webtest Models ---

class WebtestTask(db.Model):
    __tablename__ = 'webtest_tasks'
    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.String(50))
    url = db.Column(db.Text, nullable=False, unique=True)
    query_details = db.Column(db.Text)
    
    histories = db.relationship('WebtestHistory', backref='task', cascade="all, delete-orphan", lazy=True)

class WebtestHistory(db.Model):
    __tablename__ = 'webtest_histories'
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('webtest_tasks.id'), nullable=False)
    server = db.Column(db.String(50))
    version = db.Column(db.String(50))
    url = db.Column(db.Text)
    query_results = db.Column(db.Text)
    delay = db.Column(db.Float)
    query_date = db.Column(db.DateTime, default=datetime.utcnow)
    query_details = db.Column(db.Text)
    count = db.Column(db.String(50))
    notes = db.Column(db.Text)


# --- Examine Feature Models ---

class ExaminePrompt(db.Model):
    """Stores admin-managed clinical query templates for the Examine tab."""
    __tablename__ = 'examine_prompts'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    prompt_text = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text, nullable=True)  # Tooltip / helper text
    display_order = db.Column(db.Integer, default=0)
    is_active = db.Column(db.Boolean, default=True)
    is_custom = db.Column(db.Boolean, default=False, nullable=False)
    set_id = db.Column(db.String(100), nullable=True, index=True)
    generic_name = db.Column(db.String(255), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    histories = db.relationship('ExamineHistory', backref='prompt', lazy=True, foreign_keys='ExamineHistory.prompt_id')


class ExamineHistory(db.Model):
    """Caches AI-generated answers for a given label set_id and prompt."""
    __tablename__ = 'examine_history'
    id = db.Column(db.Integer, primary_key=True)
    set_id = db.Column(db.String(100), nullable=False, index=True)
    prompt_id = db.Column(db.Integer, db.ForeignKey('examine_prompts.id'), nullable=True)
    prompt_text_snapshot = db.Column(db.Text, nullable=False)  # Snapshot at time of run
    generated_answer = db.Column(db.Text, nullable=False)
    model_used = db.Column(db.String(100), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
