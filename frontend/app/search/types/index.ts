export interface Filters {
  labelingType: string[];
  applicationType: string[];
  labelingSection: string[];
  drugNames: string[];
  adverseEvents: string[];
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
