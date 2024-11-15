export interface JobBody {
  type: (typeof validTypes)[number];
  content: string;
  groups: string[];
  users: string[];
  tags: string[];
  externalId: string;
  hashSuffix?: string;
  urls?: string[];
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

export interface IsGrantUpdateJobBody {
  castContent: string;
  grantDescription: string;
  parentFlowDescription: string;
  castHash: string;
  grantId: string;
  urls: string[];
}

export interface BuilderProfileJobBody {
  fid: string;
}
