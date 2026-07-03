export const MEMORY_TYPES = [
  'decision',
  'failed_attempt',
  'fragile_file',
  'architecture',
  'deployment',
  'client_preference',
  'session_summary',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const SEVERITIES = ['info', 'warn', 'block'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONFIDENCES = ['unverified', 'agent_claimed', 'human_verified'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const STATUSES = ['active', 'stale', 'archived', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];

export interface MemoryRef {
  refType: 'file' | 'commit' | 'branch' | 'pr';
  refValue: string;
  fileContentHash?: string | null;
}

export interface Memory {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  severity: Severity;
  confidence: Confidence;
  status: Status;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  sourceSession?: string | null;
  refs: MemoryRef[];
}

export interface NewMemory {
  type: MemoryType;
  title: string;
  body: string;
  severity?: Severity;
  confidence?: Confidence;
  createdBy?: string;
  sourceSession?: string | null;
  files?: string[];
}

export interface RecallOptions {
  query?: string;
  type?: MemoryType;
  file?: string;
  limit?: number;
  includeStale?: boolean;
}

export const MEMORY_FILE_BY_TYPE: Record<MemoryType, string> = {
  decision: 'decisions.md',
  failed_attempt: 'failed_attempts.md',
  fragile_file: 'fragile_files.md',
  architecture: 'architecture.md',
  deployment: 'deployment.md',
  client_preference: 'client_preferences.md',
  session_summary: 'sessions.md',
};

export const TYPE_HEADINGS: Record<MemoryType, string> = {
  decision: 'Decisions',
  failed_attempt: 'Failed Attempts',
  fragile_file: 'Fragile Files',
  architecture: 'Architecture Notes',
  deployment: 'Deployment Rules',
  client_preference: 'Client Preferences',
  session_summary: 'Session Summaries',
};
