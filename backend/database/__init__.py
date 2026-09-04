from .extensions import db, migrate, login_manager
from .models import (
    ROLES, ROLE_USER, ROLE_DEVELOPER, ROLE_ADMIN, GUEST_USERNAME,
    User, Project, Favorite, Annotation, FavoriteComparison, LabelAnnotation, ComparisonSummary,
    DrugToxicity, DiliRo2Reference,
    MeddraSOC, MeddraHLGT, MeddraHLT, MeddraPT, MeddraLLT, MeddraMDHIER, MeddraSMQList, MeddraSMQContent,
    PgxBiomarker, PgxSynonym, PgxAssessment,
    ProjectAeReport, ProjectAeReportDetail,
    AeAiAssessment, OrangeBook, SystemTask, DatabaseUpdateLog,
    DrugLabel, ActiveIngredientMap, LabelMeddraProfile, LabelPvProfile, LabelPvFeedback, TokenUsage,
    SearchHistory, UserQueryHistory,
    ExaminePrompt, ExamineHistory,
    FeatureGate
)
