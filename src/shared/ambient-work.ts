import type { ReasoningEffort } from './session.js';

/** Read-only projections of the existing recorder, broker and durable input authorities. */
export type AmbientStage = 'idle' | 'queued' | 'preparing' | 'selecting-model' | 'opening-workspace' | 'working' |
  'waiting-provider' | 'waiting-permission' | 'verifying' | 'packaging' | 'blocked' | 'failed' | 'cancelled' | 'complete';

export interface AmbientModel {
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  evidence: 'confirmed' | 'requested' | 'unknown';
}
export interface AmbientOutput {
  id: string;
  sessionId: string;
  eventSeq: number;
  outputIndex: number;
  name: string;
  kind: 'file' | 'image';
  createdAt: number;
}
export interface AmbientActivity {
  id: string;
  taskId: string;
  workerId: string | null;
  timestamp: number;
  stage: AmbientStage;
  description: string;
  model: AmbientModel;
  output?: AmbientOutput;
  error?: { code: string; recoverable: boolean; userActionRequired: boolean };
  count: number;
}
export interface AmbientWorker {
  id: string;
  runId: string | null;
  sessionId: string | null;
  conversationId: string | null;
  name: string;
  task: string;
  state: string;
  active: boolean;
  model: AmbientModel;
}
export type AmbientAction = 'pause' | 'resume' | 'stop' | 'retry' | 'foreground';
export interface AmbientControl {
  action: AmbientAction;
  label: string;
  enabled: boolean;
  reason?: string;
  inputId?: string;
}
export interface AmbientTarget {
  sessionId: string;
  conversationId: string;
  turnId: string | null;
}
export interface AmbientTask extends AmbientTarget {
  /** Present before a new outbox task has a recorded conversation; session/conversation IDs are then empty. */
  inputId?: string;
  id: string;
  title: string;
  state: AmbientStage;
  stage: string;
  startedAt: number | null;
  updatedAt: number;
  live: boolean;
  /** Exact durable completed turn/finish receipt, never session archival or disappearance. */
  completionId: string | null;
  /** Only a fully acknowledged authored plan may provide numerical progress. */
  progress: { completed: number; total: number } | null;
  model: AmbientModel;
  workers: AmbientWorker[];
  activity: AmbientActivity[];
  outputs: AmbientOutput[];
  controls: AmbientControl[];
  warning: string | null;
}
export interface AmbientCompletion {
  id: string;
  taskId: string;
  summary: string;
  output?: AmbientOutput;
}
export interface AmbientSnapshot {
  revision: number;
  tasks: AmbientTask[];
  /** Only transitions observed live in this main-process lifetime are eligible. */
  completions: AmbientCompletion[];
  notificationsEnabled: boolean;
  error?: string;
}
export interface AmbientControlRequest extends AmbientTarget { action: AmbientAction; inputId?: string }

export const AMBIENT_STAGE_LABELS: Record<AmbientStage, string> = {
  idle: 'Idle', queued: 'Queued', preparing: 'Preparing', 'selecting-model': 'Selecting model',
  'opening-workspace': 'Opening isolated workspace', working: 'Working', 'waiting-provider': 'Waiting for provider',
  'waiting-permission': 'Waiting for permission', verifying: 'Verifying', packaging: 'Packaging',
  blocked: 'Blocked', failed: 'Failed', cancelled: 'Cancelled', complete: 'Complete'
};
