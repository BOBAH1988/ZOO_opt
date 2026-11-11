export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  ownerUid: string;
}

export interface NewClientInput {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  notes?: string;
}

export interface UpdateClientInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
}

export interface WorkflowScenario {
  id: string;
  name: string;
  description: string;
  warning: string | null;
  testModeDefault: boolean;
  inputs: WorkflowInput[];
}

export interface WorkflowInput {
  key: string;
  label: string;
  type: 'boolean' | 'string';
  defaultValue: boolean | string;
  description: string;
  required: boolean;
}

export interface RunLog {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'accepted' | 'error';
  message: string;
  runUrl?: string | null;
  requestedBy: string;
  requestedByEmail?: string | null;
  inputs: Record<string, boolean | string>;
  createdAt: string;
}