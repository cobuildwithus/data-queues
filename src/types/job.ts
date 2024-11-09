export interface JobBody {
  type: (typeof validTypes)[number];
  content: string;
  groups: string[];
  users: string[];
  tags: string[];
  externalId: string;
  hashSuffix?: string;
}

export interface DeletionJobBody {
  contentHash: string;
  type: (typeof validTypes)[number];
}

export const validTypes = [
  'grant',
  'cast',
  'grant-application',
  'flow',
  'dispute',
  'draft-application',
];
