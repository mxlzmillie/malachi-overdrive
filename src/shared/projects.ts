/** Explicit local folder selection. The project grants no filesystem permission. */
export interface LocalProject {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  kind?: 'collection' | 'work';
  summary?: string;
  brief?: string;
  category?: string;
}
