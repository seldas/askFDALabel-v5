export interface Section {
  id?: string;
  numeric_id?: string;
  title?: string;
  content?: string;
  is_boxed_warning?: boolean;
  children?: Section[];
}

export interface Highlight {
  source_section_title: string;
  content_html: string;
}

export interface TOCItem {
  id: string;
  title: string;
  numeric_id?: string;
  children?: TOCItem[];
  is_boxed_warning?: boolean;
  is_highlights?: boolean;
  is_drug_facts?: boolean;
  is_drug_facts_item?: boolean;
}

export interface Annotation {
  id: string;
  section_number: string;
  question: string;
  answer: string;
  keywords: string[];
  is_public: boolean;
}

export interface ProductIngredient {
  type: string;
  name: string;
  strength: string;
}

export interface ProductPackaging {
  quantity: string;
  form: string;
}

export interface ProductData {
  ndc: string;
  name: string;
  form: string;
  app_num: string;  // e.g. "NDA210868"
  app_type: string; // e.g. "NDA", "ANDA", "BLA"
  ingredients: ProductIngredient[];
  packaging: ProductPackaging[];
}

export interface CompanyInfo {
  name: string;
  role: string;
  address?: string;
  duns?: string;
  safety_phone?: string;
  source: string;
}

export interface LabelData {
  drug_name: string;
  brand_name: string | null;
  generic_name: string | null;
  original_title: string;
  faers_drug_name: string;
  manufacturer_name: string;
  companies: CompanyInfo[];
  effective_time: string;
  label_format: string | null;
  ndc: string | null;
  application_number: string | null;
  version_number: string | null;
  document_type: string | null;
  has_boxed_warning: boolean;
  is_rld?: boolean;
  is_rs?: boolean;
  is_latest?: boolean;
  openfda_status?: 'Current' | 'Archived' | 'Earlier Version' | null;
  clean_app_num: string | null;
  sections: Section[];
  fallback_html: string | null;
  highlights: Highlight[];
  table_of_contents: TOCItem[];
  product_data: ProductData[];
  label_xml_raw: string;
  set_id: string;
  metadata: any;
  saved_annotations: Annotation[];
  tox_summary: {
    dili: boolean;
    dict: boolean;
    diri: boolean;
    last_updated?: string;
  };
  user_id: number | null;
}
