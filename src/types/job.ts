export interface JobBody {
  type: 'grant' | 'cast';
  content: string;
  groups: string[];
  users: string[];
}
