# Database Consolidation & Migration Plan (v3)

## Objective
Consolidate all project data into a single SQLite database (`data/afd.db`) and organize database management into a dedicated `backend/database/` package.

## 1. Architectural Refactoring: `backend/database/`
Create a central package to manage the shared data layer for all suite applications.

### New Structure
- `backend/database/__init__.py`: Exports `db` and all models for easier importing.
- `backend/database/extensions.py`: Initialized `db = SQLAlchemy()`. (Moved from `dashboard/extensions.py`)
- `backend/database/models.py`: All class definitions (User, Project, MedDRA, PGx, DrugToxicity). (Moved and consolidated from `dashboard/models.py`)

### Impact on Imports
Blueprints will now use:
`from database import db, User, DrugToxicity`

## 2. Model Centralization
The following models will be consolidated in `backend/database/models.py`:
- **Identity**: `User`, `Project`
- **User Content**: `Favorite`, `Annotation`, `LabelAnnotation`, `FavoriteComparison`, `ComparisonSummary`
- **Pharmacology/Tox**: `DrugToxicity` (New), `DiliAssessment`, `DictAssessment`, `DiriAssessment`
- **MedDRA**: `MeddraSOC`, `MeddraHLGT`, `MeddraHLT`, `MeddraPT`, `MeddraLLT`, `MeddraMDHIER`, `MeddraSMQList`, `MeddraSMQContent`
- **PGx**: `PgxBiomarker`, `PgxSynonym`, `PgxAssessment`

## 3. Migration Suite (`scripts/migration/`)
A set of ordered scripts to populate the fresh `afd.db` from raw sources in `./data/downloads/`.

- `scripts/migration/01_import_meddra.py`:
    - **Source**: `./data/downloads/MedDRA/MedDRA_latest/MedAscii/`
    - **Logic**: Bulk insert into MedDRA hierarchical tables.
- `scripts/migration/02_import_pgx.py`:
    - **Source**: `./data/downloads/biomarker_db/Table of Pharmacogenomic Biomarkers in Drug Labeling FDA.xlsx`
    - **Logic**: Parse drug-biomarker pairs and populate PGx tables + synonyms.
- `scripts/migration/03_import_drugtox.py`:
    - **Source**: `./data/ALT_update_02102026.xlsx`
    - **Logic**: Standardize toxicity classes and calculate historical flags.

## 4. Implementation Workflow
1.  **Create Directories**: `backend/database/` and `scripts/migration/`.
2.  **Move & Refactor**: Move extensions/models and update all `import` statements across the backend.
3.  **Schema Initialization**: Use `db.create_all()` within a setup script to initialize `data/afd.db`.
4.  **Execute Migrations**: Run the import scripts in sequence.
5.  **Verification**: Confirm data integrity across all app features.
