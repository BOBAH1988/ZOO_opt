export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
  /** Город из адреса клиента. */
  city?: string;
  /** Улица, дом, корпус из адреса клиента. */
  street?: string;
  day?: string;
  mode?: string;
  manager?: string;
  notes?: string;
  active?: boolean;
  title?: string;
  /** Код клиента: цифры или буквенно-цифровой код (например, «Б2902»). */
  clientCode?: string;
  /** Заказы клиента — произвольная текстовая строка. */
  orders?: string;
  grade?: 'Gold' | 'Silver' | 'Bronze';
  createdAt: string;
  updatedAt: string;
  ownerUid: string;
}

export interface NewClientInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  /** Город из адреса клиента. */
  city?: string;
  /** Улица, дом, корпус из адреса клиента. */
  street?: string;
  day?: string;
  mode?: string;
  manager?: string;
  notes?: string;
  active?: boolean;
  title?: string;
  /** Код клиента: цифры или буквенно-цифровой код (например, «Б2902»). */
  clientCode?: string;
  /** Заказы клиента — произвольная текстовая строка. */
  orders?: string;
  grade?: 'Gold' | 'Silver' | 'Bronze';
}

export interface UpdateClientInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  /** Город из адреса клиента. */
  city?: string;
  /** Улица, дом, корпус из адреса клиента. */
  street?: string;
  day?: string;
  mode?: string;
  manager?: string;
  notes?: string;
  active?: boolean;
  title?: string;
  /** Код клиента: цифры или буквенно-цифровой код (например, «Б2902»). */
  clientCode?: string;
  /** Заказы клиента — произвольная текстовая строка. */
  orders?: string;
  grade?: 'Gold' | 'Silver' | 'Bronze';
}

export interface WorkflowScenario {
  id: string;
  name: string;
  day: string;
  time?: string;
  description: string;
  warning?: string | null;
  inputs: WorkflowInput[];
}

export interface WorkflowInput {
  key: string;
  label: string;
  type: 'boolean' | 'string' | 'multiselect';
  defaultValue: boolean | string | string[];
  description: string;
  required: boolean;
  options?: { label: string; value: string }[];
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