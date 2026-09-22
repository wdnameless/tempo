import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, FileText, Loader2 } from 'lucide-react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  listDrawings,
  createDrawing,
  deleteDrawing,
  updateDrawing,
  getDrawingRaw,
  loadScene,
  type DrawingItem,
} from '../services/drawings';
import { I18nService } from '../services/i18n';

type ExcalidrawOnChange = NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>;
type ExcalidrawElements = Parameters<ExcalidrawOnChange>[0];

interface LoadedSceneState {
  id: string;
  elements: ExcalidrawElements;
  appState: Record<string, unknown>;
}

export function DrawingsView(): React.JSX.Element {
  const t = I18nService.t();

  const [drawings, setDrawings] = useState<DrawingItem[]>([]);
  const [activeDrawingId, setActiveDrawingId] = useState<string | null>(null);
  const [sceneData, setSceneData] = useState<LoadedSceneState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const saveTimerRef = useRef<number | undefined>(undefined);
  const pendingSaveRef = useRef<{ drawingId: string; payload: string } | null>(null);

  const flushSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = undefined;
    if (pendingSaveRef.current) {
      const { drawingId, payload } = pendingSaveRef.current;
      pendingSaveRef.current = null;
      void updateDrawing(drawingId, { scene_json: payload });
    }
  }, []);
  // Initial load: fetch drawings
  useEffect(() => {
    let isMounted = true;
    void listDrawings()
      .then((items) => {
        if (!isMounted) return;
        setDrawings(items);
        if (items.length > 0) {
          setActiveDrawingId(items[0].id);
        }
        setLoading(false);
      })
      .catch(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      flushSave();
    };
  }, [flushSave]);

  // Load drawing scene when selection changes
  useEffect(() => {
    if (!activeDrawingId) return;

    let isMounted = true;
    void loadScene(activeDrawingId).catch(() => {});
    void getDrawingRaw(activeDrawingId).then((meta) => {
      if (!isMounted) return;
      if (!meta) {
        setSceneData({ id: activeDrawingId, elements: [], appState: { theme: 'dark' } });
        return;
      }
      try {
        const parsed = JSON.parse(meta.scene_json);
        if (parsed && Array.isArray(parsed.elements)) {
          setSceneData({
            id: activeDrawingId,
            elements: parsed.elements,
            appState: { theme: 'dark', ...parsed.appState },
          });
          return;
        }
      } catch {
        // Fallback for legacy format or unparseable JSON
      }
      setSceneData({ id: activeDrawingId, elements: [], appState: { theme: 'dark' } });
    });

    return () => {
      isMounted = false;
      flushSave();
    };
  }, [activeDrawingId, flushSave]);

  // Debounced auto-save on Excalidraw changes
  const handleExcalidrawChange = useCallback(
    (...[elements, appState]: Parameters<ExcalidrawOnChange>) => {
      if (!activeDrawingId) return;

      clearTimeout(saveTimerRef.current);

      const payload = JSON.stringify({
        version: 2,
        elements,
        appState: {
          viewBackgroundColor: appState?.viewBackgroundColor,
          currentItemFontFamily: appState?.currentItemFontFamily,
        },
      });
      pendingSaveRef.current = { drawingId: activeDrawingId, payload };

      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = undefined;
        if (pendingSaveRef.current?.drawingId === activeDrawingId) {
          pendingSaveRef.current = null;
        }
        void updateDrawing(activeDrawingId, { scene_json: payload });
      }, 800);
    },
    [activeDrawingId]
  );

  // Create new drawing
  const handleCreateNew = async () => {
    try {
      const nextNum = drawings.length + 1;
      const created = await createDrawing({ title: `${t.navDrawings} ${nextNum}` });
      setDrawings((prev) => [created, ...prev]);
      setActiveDrawingId(created.id);
    } catch {
      // Ignore
    }
  };

  // Delete drawing
  const handleDeleteDrawing = async (id: string) => {
    const drawing = drawings.find((d) => d.id === id);
    const title = drawing?.title || t.navDrawings;
    const msg = t.vaultConfirmDelete ? t.vaultConfirmDelete.replace('{name}', title) : `Delete "${title}"?`;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(msg)) {
      return;
    }
    try {
      await deleteDrawing(id);
      const remaining = drawings.filter((d) => d.id !== id);
      setDrawings(remaining);
      if (activeDrawingId === id) {
        setActiveDrawingId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch {
      // Ignore
    }
  };

  return (
    <div className="flex flex-1 h-full w-full overflow-hidden select-none bg-black text-white" data-testid="drawings-view">
      {/* Drawings sidebar */}
      <aside className="w-56 border-r border-white/10 bg-[#060608] flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 py-3 border-b border-white/10">
          <span className="text-xs font-bold uppercase tracking-wider text-white/60">{t.navDrawings}</span>
          <button
            type="button"
            onClick={handleCreateNew}
            title={t.drawingsNew}
            aria-label={t.drawingsNew}
            className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {drawings.map((drawing) => {
            const isActive = drawing.id === activeDrawingId;
            return (
              <div
                key={drawing.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveDrawingId(drawing.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setActiveDrawingId(drawing.id);
                  }
                }}
                className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-[#222226] text-white font-semibold'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                  {drawing.preview_path && (
                    <img
                      src={convertFileSrc(drawing.preview_path, 'tempo-media')}
                      alt={drawing.title}
                      className="w-4 h-4 rounded object-cover shrink-0 border border-white/10"
                    />
                  )}
                  <span className="truncate">{drawing.title}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteDrawing(drawing.id);
                  }}
                  title={t.drawingsDelete}
                  aria-label={t.drawingsDelete}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:text-red-400 hover:bg-white/10 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Excalidraw editor area */}
      <main className="flex-1 h-full w-full relative overflow-hidden bg-[#121212]">
        {loading ? (
          <div className="flex items-center justify-center h-full text-white/50 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-xs">Загрузка...</span>
          </div>
        ) : sceneData ? (
          <div className="w-full h-full relative" style={{ height: '100%', width: '100%' }}>
            <Excalidraw
              key={sceneData.id}
              theme="dark"
              initialData={{
                elements: sceneData.elements,
                appState: { theme: 'dark', ...sceneData.appState },
              }}
              onChange={handleExcalidrawChange}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-white/40 p-6 text-center">
            <FileText className="w-12 h-12 mb-3 stroke-1 text-white/30" />
            <p className="text-sm text-white/60 max-w-sm">{t.drawingsEmpty}</p>
            <button
              type="button"
              onClick={handleCreateNew}
              className="mt-4 px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-white/90 transition-colors cursor-pointer"
            >
              {t.drawingsNew}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
