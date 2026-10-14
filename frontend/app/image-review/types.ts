export type Side = 'left' | 'right';
export type ReviewMode = 'artwork' | 'confusion' | 'consistency';
export type Region = { x: number; y: number; w: number; h: number };
export type Source = { set_id?: string | null; spl_id?: string | null; image_id?: string | null; filename?: string; source?: string; version_verified?: boolean; image_hash?: string; width?: number; height?: number };
export type Selection = { descriptor: Source; file: File | null; url: string; ready: boolean };
export type Finding = {
  id: number; title: string; kind: 'difference' | 'confusion' | 'inconsistency';
  category: string; priority: 'critical' | 'review' | 'informational'; confidence: string;
  observation: string; risk: string; left_text: string; right_text: string;
  label_evidence: { side: Side; quote: string }[]; regions: Record<Side, Region | null>;
};
export type Review = { mode: ReviewMode; summary: string; findings: Finding[]; limitations: string[]; sources: Record<Side, Source>; model: string; cached: boolean; consistency_status: Record<Side, string>; comparison_level?: 'overview' | 'detailed'; detail_status?: 'pending' | 'unavailable' | 'complete' | 'failed' };
export type Decision = { status: 'unreviewed' | 'confirmed' | 'dismissed'; note: string; is_public?: boolean; saved?: boolean };
export type ReviewComment = {
  id: number;
  task_id: number;
  finding_id: number;
  user_id: number;
  username: string;
  set_id?: string | null;
  decision: 'unreviewed' | 'confirmed' | 'dismissed';
  comment: string;
  is_public: boolean;
  is_mine: boolean;
  regions?: Record<Side, Region | null> | null;
  created_at?: string;
  updated_at?: string;
};
export const MODES: { id: ReviewMode; label: string; description: string }[] = [
  { id: 'consistency', label: 'Labeling Consistency', description: 'Audit one packaging artwork against its official FDA SPL labeling content to detect discrepancies, omissions, and errors.' },
  { id: 'artwork', label: 'Artwork Comparison', description: 'Compare content and design changes between two artworks, with repeated color changes grouped into one finding.' },
  { id: 'confusion', label: 'Product Confusion', description: 'Review visual similarities between two products and whether names, strengths, and distinctions are prominent.' },
];
