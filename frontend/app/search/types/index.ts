import type { TargetDb, WireQuery } from '../../querybuilder/types';

export type ActionButton =
  | {
      type: 'spl_view';
      label: string;
      set_id: string;
      spl_id?: string;
    }
  | {
      type: 'labelcomp';
      label: string;
      set_ids: string[];
      spl_ids?: string[];
    }
  | {
      type: 'labelquery';
      label: string;
      wire_query: WireQuery;
      target_db?: TargetDb;
    }
  | {
      type: 'drugtox';
      label: string;
      query?: string;
      set_id?: string;
      agent?: 'dili' | 'dict' | 'diri' | 'pgx';
    }
  | {
      type: 'label_history';
      label: string;
      set_id?: string;
      application_number?: string;
    }
  | {
      type: 'faers';
      label: string;
      set_id: string;
    };

export interface ToolStep {
  tool: string;
  summary?: string;
  status: 'running' | 'done';
}

export interface ActiveFocus {
  set_id?: string;
  spl_id?: string;
  brand_name?: string;
  generic_name?: string;
  application_number?: string;
  manufacturer?: string;
  revised_date?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: ActionButton[];
  toolSteps?: ToolStep[];
  followUps?: string[];
  focus?: ActiveFocus;
  modelUsed?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  model: string;
}

export interface HistoryItem {
  id: number;
  title: string;
  chat_data: ChatMessage[];
  timestamp: string;
}
