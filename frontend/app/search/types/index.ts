// No adverseEvents or labelingSection: both filtered on label section text,
// which the backend can no longer search since labeling.spl_sections was
// dropped. Chat search matches drug names, NDCs and label metadata only.
export interface Filters {
  labelingType: string[];
  applicationType: string[];
  drugNames: string[];
  ndcs: string[];
  isRx: boolean;
}

export interface ResultItem {
  PRODUCT_NAMES: string;
  GENERIC_NAMES: string;
  COMPANY: string;
  APPR_NUM: string;
  ACT_INGR_NAMES: string;
  MARKET_CATEGORIES: string;
  DOCUMENT_TYPE: string;
  Routes: string;
  DOSAGE_FORMS: string;
  EPC: string;
  NDC_CODES: string;
  set_id: string;
  similarity_score: number;
  keywords: string;
  section_code: string;
  section_content: string;
}
