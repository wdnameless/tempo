export type DataTable = 'alarms' | 'tasks' | 'lists' | 'notes' | 'events' | 'drawings' | 'recordings';

type DataChangedListener = (table: DataTable, ids?: string[]) => void;
const listeners = new Set<DataChangedListener>();

export function emitDataChanged(table: DataTable, ids?: string[]): void {
  for (const listener of listeners) {
    try {
      listener(table, ids);
    } catch (e) {
      console.error('Error in onDataChanged listener:', e);
    }
  }
}

export function onDataChanged(cb: DataChangedListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
