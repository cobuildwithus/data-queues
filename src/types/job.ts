export interface JobBody {
  type: (typeof validTypes)[number];
  content: string;
  groups: string[];
  users: string[];
  tags: string[];
  externalId: string;
  externalUrl?: string;
  hashSuffix?: string;
  urls?: string[];
  rawContent?: string;
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
  'builder-profile',
  'story',
] as const;

export interface IsGrantUpdateJobBody {
  castContent: string;
  grantDescription: string;
  parentFlowDescription: string;
  castHash: string;
  builderFid: string;
  grantId: string;
  urls: string[];
}

export interface BuilderProfileJobBody {
  fid: string;
}

export interface StoryJobBody {
  newCastId: number;
  grantId: string;
}
