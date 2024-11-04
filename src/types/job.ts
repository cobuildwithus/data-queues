export interface JobBody {
  type: 'grant' | 'cast';
  content: string;
  group: string[];
  user: string[];
}
