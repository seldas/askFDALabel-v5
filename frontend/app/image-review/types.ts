export type Side = 'left' | 'right';
export type ReviewMode = 'artwork' | 'confusion' | 'consistency';
export type Region = { x: number; y: number; w: number; h: number };
export type Source = { set_id?: string | null; spl_id?: string | null; image_id?: string | null; filename?: string; source?: string; version_verified?: boolean; image_hash?: string; width?: number; height?: number };
export type Selection = { descriptor: Source; file: File | null; url: string; ready: boolean };
export const CARTON_FIELDS = { brand_name: 'Brand name', generic_name: 'Generic name', strength: 'Strength / concentration', dosage_form: 'Dosage form', route: 'Route', pack_quantity: 'Pack quantity', manufacturer: 'Manufacturer', warnings: 'Visible warnings' } as const;
export type CartonField = keyof typeof CARTON_FIELDS;
export type PackagingImageType = 'carton' | 'container_label';
export type CartonExtraction = {
  suitability: 'supported' | 'carton' | 'uncertain' | 'unsupported'; image_type?: PackagingImageType | 'unknown'; reason: string; view: string;
  limitations: string[]; visual_features: string;
  fields: Record<CartonField, { value: string; status: 'readable' | 'uncertain' | 'not_visible'; region: Region | null }>;
};
export type CartonConfirmation = { task_id: number; confirmation_token?: string; image_type: PackagingImageType; acknowledged: boolean; fields: Record<CartonField, string> };
export type CartonInputs = Record<Side, CartonConfirmation>;
export type SavedCarton = { extraction: CartonExtraction; image_type?: PackagingImageType; confirmed_fields: Record<CartonField, { value: string; source: 'user_provided' | 'image_extraction' }>; extraction_task_id: number; acknowledged: boolean };
export type Finding = {
  id: number; title: string; kind: 'difference' | 'confusion' | 'inconsistency';
  category: string; priority: 'critical' | 'review' | 'informational'; confidence: string;
  observation: string; risk: string; left_text: string; right_text: string;
  label_evidence: { side: Side; quote: string }[]; regions: Record<Side, Region | null>;
};
export type Review = { mode: ReviewMode; summary: string; findings: Finding[]; limitations: string[]; sources: Record<Side, Source>; model: string; cached: boolean; consistency_status: Record<Side, string>; comparison_level?: 'overview' | 'detailed'; detail_status?: 'pending' | 'unavailable' | 'complete' | 'failed'; assessment?: string; distinguishing_factors?: string[]; carton_inputs?: Record<Side, SavedCarton> };
export type Decision = { status: 'unreviewed' | 'confirmed' | 'dismissed'; note: string; is_public?: boolean; saved?: boolean };
export type ReviewComment = {
  id: number;
  task_id: number;
  finding_id: number;
  user_id: number;
  username: string;
  display_name?: string;
  set_id?: string | null;
  decision: 'unreviewed' | 'confirmed' | 'dismissed';
  comment: string;
  is_public: boolean;
  is_mine: boolean;
  regions?: Record<Side, Region | null> | null;
  created_at?: string;
  updated_at?: string;
};
export type VisualTask = ReviewMode | 'read';
export const VISUAL_TASKS: { id: VisualTask; label: string; description: string; needs: string }[] = [
  { id: 'read', label: 'Read image', description: 'Extract visible text and organize the information.', needs: '1 image' },
  { id: 'consistency', label: 'Labeling consistency', description: 'Check an image against its official labeling.', needs: '1 image + labeling' },
  { id: 'artwork', label: 'Artwork comparison', description: 'Find content and design changes between images.', needs: '2 images' },
  { id: 'confusion', label: 'Product confusion', description: 'Review similarities that could cause product confusion.', needs: '2 packaging images' },
];
