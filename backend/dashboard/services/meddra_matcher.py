import logging
import json
from datetime import datetime
from flashtext import KeywordProcessor
from database import db, MeddraPT, MeddraLLT, LabelMeddraProfile

logger = logging.getLogger(__name__)

# List of MedDRA terms that are too common in general English/Labeling context
# and lead to false positives (e.g., "ALL" as in "all patients").
MEDDRA_EXCLUSION_LIST = set([
    'ALL', 'HIGH', 'LOW', 'FALL', 'MAY', 'CAN', 'OFF', 'BIT', 'SET', 'BAD', 
    'LEAD', 'MASS', 'BORN', 'AGE', 'NORMAL', 'LONG', 'SKIN', 'BODY', 'STING',
    'GAS', 'GRIP', 'TALK', 'WALK', 'HEAL', 'FEEL', 'FILL', 'IRON', 'COKE'
])

class MeddraMatcher:
    _instance = None
    _processor = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.processor = KeywordProcessor(case_sensitive=False)
        self._loaded = False

    def load_dictionary(self):
        """Loads all PTs and LLTs from the database into the FlashText processor, with filtering."""
        if self._loaded:
            return

        try:
            logger.info("Loading MedDRA dictionary into memory...")
            
            # 1. Load PTs
            pts = db.session.query(MeddraPT.pt_name).all()
            for pt in pts:
                name = pt.pt_name.strip()
                if name.upper() not in MEDDRA_EXCLUSION_LIST and len(name) > 2:
                    self.processor.add_keyword(name)

            # 2. Load LLTs
            llts = db.session.query(MeddraLLT.llt_name).all()
            for llt in llts:
                name = llt.llt_name.strip()
                if name.upper() not in MEDDRA_EXCLUSION_LIST and len(name) > 2:
                    self.processor.add_keyword(name)

            self._loaded = True
            logger.info(f"Loaded {len(self.processor)} MedDRA terms (filtered).")
        except Exception as e:
            logger.error(f"Error loading MedDRA dictionary: {e}")

    def scan_text(self, text):
        """
        Scans the provided text and returns a list of found MedDRA terms.
        Returns a list of unique terms found.
        """
        if not self._loaded:
            self.load_dictionary()
        
        if not text:
            return []

        # Extract keywords
        # FlashText extracts the normalized name if provided, otherwise the keyword itself.
        found_terms = self.processor.extract_keywords(text)
        
        # Deduplicate
        return list(set(found_terms))

    def get_cached_scan(self, set_id, section_loinc):
        """Retrieves cached MedDRA terms for a specific label section."""
        try:
            cache = db.session.query(LabelMeddraProfile).filter_by(
                set_id=set_id, section_loinc=section_loinc
            ).first()
            if cache:
                return json.loads(cache.terms)
        except Exception as e:
            logger.error(f"Error reading MedDRA cache: {e}")
        return None

    def save_scan_to_cache(self, set_id, section_loinc, terms):
        """Saves scanned MedDRA terms to the database cache."""
        try:
            # Atomic upsert (simplified for SQLAlchemy)
            existing = db.session.query(LabelMeddraProfile).filter_by(
                set_id=set_id, section_loinc=section_loinc
            ).first()
            if existing:
                existing.terms = json.dumps(terms)
                existing.created_at = datetime.utcnow()
            else:
                new_cache = LabelMeddraProfile(
                    set_id=set_id,
                    section_loinc=section_loinc,
                    terms=json.dumps(terms)
                )
                db.session.add(new_cache)
            db.session.commit()
        except Exception as e:
            logger.error(f"Error saving MedDRA cache: {e}")
            db.session.rollback()

# Global helper
def scan_label_for_meddra(text, set_id=None, section_loinc=None, return_stats=False):
    matcher = MeddraMatcher.get_instance()
    is_hit = False
    
    # 1. Check cache if set_id/section provided
    if set_id and section_loinc:
        cached_terms = matcher.get_cached_scan(set_id, section_loinc)
        if cached_terms is not None:
            is_hit = True
            if return_stats:
                return cached_terms, True
            return cached_terms

    # 2. Perform scan
    terms = matcher.scan_text(text)

    # 3. Save to cache if applicable
    if set_id and section_loinc:
        matcher.save_scan_to_cache(set_id, section_loinc, terms)

    if return_stats:
        return terms, False
    return terms

