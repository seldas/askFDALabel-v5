from .extensions import db, migrate, login_manager
from .models import (
    User, Project, Favorite, Annotation, FavoriteComparison, LabelAnnotation, ComparisonSummary,
    DrugToxicity, DiliRo2Reference,
    MeddraSOC, MeddraHLGT, MeddraHLT, MeddraPT, MeddraLLT, MeddraMDHIER, MeddraSMQList, MeddraSMQContent,
    PgxBiomarker, PgxSynonym, PgxAssessment,
    ProjectAeReport, ProjectAeReportDetail,
    AeAiAssessment, OrangeBook, SystemTask,
    DrugLabel, LabelSection, ActiveIngredientMap, LabelMeddraProfile, TokenUsage,
    SearchHistory, UserQueryHistory,
    ExaminePrompt, ExamineHistory
)
