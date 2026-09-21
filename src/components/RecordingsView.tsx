import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  Monitor,
  Play,
  Pause,
  Square,
  X,
  Trash2,
  Edit2,
  Check,
  Volume2,
  AlertCircle,
  FileAudio,
  FileVideo,
  FileText,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { I18nService } from '../services/i18n';
import {
  listDevices,
  listSources,
  startRecording,
  pauseRecording,
  stopRecording,
  cancelRecording,
  recordingLevel,
  previewSource,
  recorderErrorKey,
  type DeviceInfo,
  type SourceInfo,
  type StartOptions,
} from '../services/recorder';
import {
  listRecordings,
  saveRecording,
  renameRecording,
  deleteRecording,
  recordingBytes,
  type RecordingItem,
} from '../services/recordings';
import {
  transcribeRecording,
  transcribePending,
} from '../services/transcribe';
import { sttErrorKey } from '../services/stt';

/**
 * Format elapsed seconds to mm:ss or hh:mm:ss.
 */
function formatDuration(sec: number): string {
  const rounded = Math.max(0, Math.floor(sec));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format bytes into human-readable units (B, KB, MB, GB).
 */
function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) {
    return '—';
  }
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function RecordingsView(): React.ReactElement {
  const t = I18nService.t();

  // Mode and tabs
  const [activeTab, setActiveTab] = useState<'audio' | 'screen'>('audio');

  // Audio configuration
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [includeSystem, setIncludeSystem] = useState<boolean>(false);

  // Screen configuration
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [screenConfirmed, setScreenConfirmed] = useState<boolean>(false);
  /** The preview and the source it came from: a stale frame must never be
   *  shown next to a different source, and clearing it is a derivation. */
  const [preview, setPreview] = useState<{ sourceId: string; url: string | null } | null>(null);
  const previewDataUrl = preview?.sourceId === selectedSourceId ? preview.url : null;

  // Recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [currentKind, setCurrentKind] = useState<'audio' | 'screen'>('audio');
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [audioLevel, setAudioLevel] = useState<{ peak: number; rms: number }>({ peak: 0, rms: 0 });
  /** The meter reads zero whenever nothing is being captured. */
  const level = isRecording ? audioLevel : { peak: 0, rms: 0 };
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Library state
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  // Transcription state
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [isTranscribingBatch, setIsTranscribingBatch] = useState<boolean>(false);
  const [batchResult, setBatchResult] = useState<{ succeeded: number; failed: number } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  // Timers
  const timerRef = useRef<number | null>(null);
  const levelIntervalRef = useRef<number | null>(null);

  // Refresh hardware devices and sources
  const refreshHardware = useCallback(async () => {
    const devices = listDevices()
      .then((res) => {
        const inputs = res.inputs ?? [];
        setDevices(inputs);
        // Chosen inside the updater: reading the selection from a closure would
        // give this callback a new identity every time the user picks a device,
        // and the effect would then re-enumerate the hardware on each pick.
        setSelectedDevice((prev) => prev || (inputs.find((d) => d.is_default) ?? inputs[0])?.id || '');
      })
      .catch(() => {
        // No devices is a state this screen already renders.
      });

    const sources = listSources()
      .then((list) => {
        setSources(list ?? []);
        setSelectedSourceId((prev) => prev || (list.find((s) => s.is_primary) ?? list[0])?.id || '');
      })
      .catch(() => {
        // Same: an empty source list is rendered, not thrown.
      });

    return Promise.all([devices, sources]).then(() => undefined);
  }, []);

  // Load library recordings and fetch sizes
  const refreshLibrary = useCallback((): Promise<void> => {
    return listRecordings()
      .then((list) => {
        const items = list ?? [];
        setRecordings(items);

        // Sizes arrive per file and land as they resolve: a library with a
        // hundred recordings must not wait on a hundred stats to render.
        for (const item of items) {
          void recordingBytes(item)
            .then((b) => {
              setSizes((prev) => ({ ...prev, [item.id]: b }));
            })
            .catch(() => {
              // A file that vanished shows a dash rather than breaking the row.
            });
        }
      })
      .catch(() => {
        // An unreadable library leaves the screen as it is.
      });
  }, []);

  // Initial load and tempo:recording listener
  useEffect(() => {
    void refreshHardware();
    void refreshLibrary();

    const handleRecordingEvent = (e: Event) => {
      const custom = e as CustomEvent<{ action?: 'open' | 'changed' }>;
      if (custom.detail?.action === 'changed') {
        void refreshLibrary();
      }
    };

    window.addEventListener('tempo:recording', handleRecordingEvent);
    return () => {
      window.removeEventListener('tempo:recording', handleRecordingEvent);
    };
  }, [refreshHardware, refreshLibrary]);

  // Source preview for screen tab
  useEffect(() => {
    if (activeTab !== 'screen' || !selectedSourceId) return;

    const sourceId = selectedSourceId;
    let cancelled = false;
    void previewSource(sourceId)
      .then((url) => {
        if (!cancelled) setPreview({ sourceId, url });
      })
      .catch(() => {
        if (!cancelled) setPreview({ sourceId, url: null });
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedSourceId]);

  // Elapsed timer while recording & not paused
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRecording, isPaused]);

  // Audio level polling (10 times a second) - STOPPED when not recording
  useEffect(() => {
    if (isRecording) {
      levelIntervalRef.current = window.setInterval(() => {
        void recordingLevel()
          .then((lvl) => {
            setAudioLevel(lvl);
          })
          .catch(() => {
            // Ignore polling errors
          });
      }, 100);
    } else if (levelIntervalRef.current !== null) {
      window.clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }

    return () => {
      if (levelIntervalRef.current !== null) {
        window.clearInterval(levelIntervalRef.current);
        levelIntervalRef.current = null;
      }
    };
  }, [isRecording]);

  // Handlers for recording controls
  const handleStart = async () => {
    setErrorMessage(null);

    if (activeTab === 'screen' && !screenConfirmed) {
      // A deliberate confirm, and a message that says how to give it: the
      // earlier wording described the preview and left the user stuck.
      setErrorMessage(t.recConfirmNeeded);
      return;
    }

    const options: StartOptions = {
      kind: activeTab,
      mic: selectedDevice || undefined,
      system: includeSystem,
      source_id: activeTab === 'screen' ? selectedSourceId : undefined,
    };

    try {
      await startRecording(options);
      setIsRecording(true);
      setIsPaused(false);
      setCurrentKind(activeTab);
      setElapsedSec(0);
    } catch (err: unknown) {
      const errKey = recorderErrorKey(err, activeTab);
      setErrorMessage(t[errKey] || t.recPermissionHint);
    }
  };

  const handlePauseResume = async () => {
    try {
      const nextPaused = !isPaused;
      await pauseRecording(nextPaused);
      setIsPaused(nextPaused);
    } catch (err) {
      console.warn('Failed to toggle pause:', err);
    }
  };

  const handleStop = async () => {
    try {
      const result = await stopRecording();
      setIsRecording(false);
      setIsPaused(false);
      setElapsedSec(0);

      // Save into recordings library
      await saveRecording(result, currentKind);
      await refreshLibrary();
    } catch (err) {
      console.error('Failed to stop/save recording:', err);
      setIsRecording(false);
      setIsPaused(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelRecording();
    } catch (err) {
      console.warn('Failed to cancel recording:', err);
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      setElapsedSec(0);
    }
  };

  // Library item actions
  const handleStartRename = (item: RecordingItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
  };

  const handleSaveRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await renameRecording(id, editTitle.trim());
      setEditingId(null);
      await refreshLibrary();
    } catch (err) {
      console.error('Failed to rename recording:', err);
    }
  };

  // Transcription actions
  const handleTranscribeSingle = async (rec: RecordingItem) => {
    if (transcribingId) return;
    setTranscribingId(rec.id);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[rec.id];
      return next;
    });
    try {
      await transcribeRecording(rec.id);
      await refreshLibrary();
    } catch (err) {
      const errKey = sttErrorKey(err);
      const message = (t[errKey] as string | undefined) || t.recTranscriptFailed;
      setRowErrors((prev) => ({ ...prev, [rec.id]: message }));
    } finally {
      setTranscribingId(null);
    }
  };

  const handleTranscribePending = async () => {
    setIsTranscribingBatch(true);
    try {
      const res = await transcribePending(50);
      setBatchResult({ succeeded: res.succeeded, failed: res.failed });
      await refreshLibrary();
    } catch (err) {
      console.error('Batch transcription failed:', err);
    } finally {
      setIsTranscribingBatch(false);
    }
  };
  const handleDelete = async (id: string) => {
    try {
      await deleteRecording(id);
      if (playingId === id) setPlayingId(null);
      await refreshLibrary();
    } catch (err) {
      console.error('Failed to delete recording:', err);
    }
  };

  const selectedSource = sources.find((s) => s.id === selectedSourceId);
  const monitorSources = sources.filter((s) => s.kind === 'monitor');
  const windowSources = sources.filter((s) => s.kind === 'window');

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-12">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">
          {t.navRecordings}
        </h1>
      </div>

      {/* Top Half: The Recorder */}
      <div className="p-6 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex flex-col gap-5 shadow-sm">
        {/* Tabs: Audio vs Screen */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
          <button
            type="button"
            disabled={isRecording}
            onClick={() => {
              setActiveTab('audio');
              setErrorMessage(null);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'audio'
                ? 'bg-white text-black shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]'
            } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Mic size={16} />
            {t.recTabAudio}
          </button>
          <button
            type="button"
            disabled={isRecording}
            onClick={() => {
              setActiveTab('screen');
              setErrorMessage(null);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'screen'
                ? 'bg-white text-black shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]'
            } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Monitor size={16} />
            {t.recTabScreen}
          </button>
        </div>

        {/* Tab Content: Audio Configuration */}
        {activeTab === 'audio' && (
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div className="flex flex-col gap-2 w-full md:w-auto">
              <label htmlFor="rec-device-select" className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                {t.recDevice}
              </label>
              {devices.length === 0 ? (
                <div className="text-sm text-[var(--text-muted)]">{t.recNoDevices}</div>
              ) : (
                <select
                  id="rec-device-select"
                  aria-label={t.recDevice}
                  disabled={isRecording}
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                >
                  {devices.map((dev) => (
                    <option key={dev.id} value={dev.id}>
                      {dev.name} {dev.is_default ? `(${t.recDefaultDevice})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2 md:pt-6">
              <input
                id="rec-system-sound"
                type="checkbox"
                disabled={isRecording}
                checked={includeSystem}
                onChange={(e) => setIncludeSystem(e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] w-4 h-4"
              />
              <label htmlFor="rec-system-sound" className="text-sm text-[var(--text)] cursor-pointer">
                {t.recSystem}
              </label>
            </div>
          </div>
        )}

        {/* Tab Content: Screen Configuration */}
        {activeTab === 'screen' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div className="flex flex-col gap-2 w-full md:w-auto">
                <label htmlFor="rec-source-select" className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  {t.recSource}
                </label>
                {sources.length === 0 ? (
                  <div className="text-sm text-[var(--text-muted)]">{t.recNoSources}</div>
                ) : (
                  <select
                    id="rec-source-select"
                    aria-label={t.recSource}
                    disabled={isRecording}
                    value={selectedSourceId}
                    onChange={(e) => {
                      setSelectedSourceId(e.target.value);
                      setScreenConfirmed(false);
                    }}
                    className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  >
                    {monitorSources.length > 0 && (
                      <optgroup label={t.recMonitors}>
                        {monitorSources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.width} × {s.height})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {windowSources.length > 0 && (
                      <optgroup label={t.recWindows}>
                        {windowSources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.width} × {s.height})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>

              {selectedSource && (
                <div className="text-xs text-[var(--text-muted)] pt-2 md:pt-6">
                  {selectedSource.width} × {selectedSource.height} px
                </div>
              )}
            </div>

            {/* Deliberate screen confirmation gate (R45) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="flex items-center gap-3">
                {previewDataUrl ? (
                  <img
                    src={previewDataUrl}
                    alt="Preview"
                    className="w-20 h-12 object-cover rounded border border-[var(--border)]"
                  />
                ) : (
                  <div className="w-20 h-12 flex items-center justify-center rounded bg-[var(--surface)] text-[var(--text-muted)]">
                    <Monitor size={18} />
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-[var(--text)]">
                    {selectedSource ? selectedSource.name : t.recSource}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {t.recPreviewHint}
                  </span>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-[var(--text)]">
                <input
                  type="checkbox"
                  disabled={isRecording}
                  checked={screenConfirmed}
                  onChange={(e) => setScreenConfirmed(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] w-4 h-4"
                />
                <span>{t.recConfirmScreen}</span>
              </label>
            </div>
          </div>
        )}

        {/* Level Meter (Polled ~10x/sec while recording, stopped otherwise) */}
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <Volume2 size={13} />
              {t.recRecording}
            </span>
            <span>{`${Math.round(level.peak * 100)}%`}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[var(--bg)] border border-[var(--border)] overflow-hidden flex">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-75"
              style={{ width: `${Math.min(100, Math.max(0, level.peak * 100))}%` }}
            />
          </div>
        </div>

        {/* Error message / permissions (R45) */}
        {errorMessage && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] text-sm text-[var(--text)]">
            <AlertCircle size={16} className="text-[var(--accent)] shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Controls: Start, Pause/Resume, Stop, Cancel, Timer */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[var(--border)]">
          <div className="flex items-center gap-3">
            {isRecording && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-sm font-semibold text-[var(--text)]">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isPaused ? 'bg-[var(--text-muted)]' : 'bg-red-500 animate-pulse'
                  }`}
                />
                <span>{formatDuration(elapsedSec)}</span>
                {isPaused && (
                  <span className="text-xs text-[var(--text-muted)] font-normal ml-1">
                    ({t.recPaused})
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isRecording ? (
              <button
                type="button"
              onClick={handleStart}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-white text-black text-sm font-bold shadow-sm hover:opacity-90 transition-opacity"
            >
                <Play size={16} />
                {t.recStart}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handlePauseResume}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  {isPaused ? (
                    <>
                      <Play size={16} />
                      {t.recResume}
                    </>
                  ) : (
                    <>
                      <Pause size={16} />
                      {t.recPause}
                    </>
                  )}
                </button>

                <button
                  type="button"
                onClick={handleStop}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-sm font-bold shadow-sm hover:opacity-90 transition-opacity"
              >
                  <Square size={16} />
                  {t.recStop}
                </button>

                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <X size={16} />
                  {t.recCancel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Half: The Library */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text)]">
            {t.navRecordings}
          </h2>
          {recordings.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTranscribePending}
                disabled={isTranscribingBatch || !!transcribingId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 transition-colors"
              >
                {isTranscribingBatch ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    {t.recTranscribe}
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    {t.recTranscribeAll}
                    {batchResult && (
                      <span className="text-xs opacity-75">
                        ({batchResult.succeeded} ok / {batchResult.failed} failed)
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {recordings.length === 0 ? (
          <div className="p-8 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-center text-sm text-[var(--text-muted)]">
            {t.recEmpty}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {recordings.map((rec) => {
              const fileSrc = convertFileSrc(rec.file_path, 'tempo-media');
              const isAudio = rec.kind === 'audio';

              return (
                <div
                  key={rec.id}
                  className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex flex-col gap-3 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="p-2 rounded-lg bg-[var(--bg)] text-[var(--text)] shrink-0">
                        {isAudio ? <FileAudio size={18} /> : <FileVideo size={18} />}
                      </div>

                      {editingId === rec.id ? (
                        <div className="flex items-center gap-2 flex-1 max-w-sm">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveRename(rec.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] w-full focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(rec.id)}
                            className="p-1 text-[var(--accent)] hover:opacity-80"
                            aria-label={t.recRename}
                          >
                            <Check size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-sm font-medium text-[var(--text)] truncate">
                            {rec.title}
                          </span>
                          {/* Per-row transcript state: only shown if transcript_status exists */}
                          {rec.transcript_status === 'pending' && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                              {t.recTranscriptPending}
                            </span>
                          )}
                          {rec.transcript_status === 'done' && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                              {t.recTranscriptDone}
                            </span>
                          )}
                          {rec.transcript_status === 'failed' && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-500/10 text-red-500 border border-red-500/20">
                              {t.recTranscriptFailed}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                      <span>{rec.kind === 'audio' ? t.recKindAudio : t.recKindScreen}</span>
                      <span>•</span>
                      <span>
                        {t.recDuration}: {formatDuration(rec.duration_sec)}
                      </span>
                      <span>•</span>
                      <span>
                        {t.recSize}: {formatBytes(sizes[rec.id])}
                      </span>

                      {/* Single Transcribe Action */}
                      <button
                        type="button"
                        onClick={() => handleTranscribeSingle(rec)}
                        disabled={transcribingId === rec.id || isTranscribingBatch}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
                        aria-label={t.recTranscribe}
                        title={t.recTranscribe}
                      >
                        {transcribingId === rec.id ? (
                          <Loader2 size={14} className="animate-spin text-primary" />
                        ) : (
                          <Sparkles size={14} />
                        )}
                      </button>
                      <div className="flex items-center gap-1 pl-2 border-l border-[var(--border)]">
                        <button
                          type="button"
                          onClick={() => handleStartRename(rec)}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
                          aria-label={t.recRename}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(rec.id)}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--surface-hover)]"
                          aria-label={t.recDelete}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Inline Playback */}
                  <div className="pt-2 border-t border-[var(--border)]">
                    {isAudio ? (
                      <audio
                        controls
                        src={fileSrc}
                        className="w-full h-8"
                        onPlay={() => setPlayingId(rec.id)}
                        onPause={() => {
                          if (playingId === rec.id) setPlayingId(null);
                        }}
                      />
                    ) : (
                      <video
                        controls
                        src={fileSrc}
                        className="w-full max-h-80 rounded-lg bg-black"
                        onPlay={() => setPlayingId(rec.id)}
                        onPause={() => {
                          if (playingId === rec.id) setPlayingId(null);
                        }}
                      />
                    )}
                  </div>

                  {/* Error state if single transcription failed */}
                  {rowErrors[rec.id] && (
                    <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
                      {rowErrors[rec.id]}
                    </div>
                  )}

                  {/* Readable Transcript */}
                  {rec.transcript ? (
                    <div className="pt-2 border-t border-[var(--border)] flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                        <FileText size={13} />
                        <span>{t.recTranscript}</span>
                      </div>
                      <p className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed bg-[var(--bg)] p-3 rounded-lg border border-[var(--border)] select-text">
                        {rec.transcript}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
