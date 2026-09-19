import React from 'react';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

export const ResizeHandles: React.FC = () => {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const handleResizeDrag = (direction: 'right' | 'bottom' | 'bottom-right' | 'left' | 'top') => {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = window.innerWidth;
      const startHeight = window.innerHeight;
      let lastW = startWidth;
      let lastH = startHeight;

      const target = e.currentTarget as HTMLElement;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort: resizing still tracks pointermove.
      }

      const onPointerMove = async (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let newW = startWidth;
        let newH = startHeight;

        if (direction === 'right' || direction === 'bottom-right') {
          lastW = newW = Math.max(220, startWidth + deltaX);
        } else if (direction === 'left') {
          lastW = newW = Math.max(220, startWidth - deltaX);
        }

        if (direction === 'bottom' || direction === 'bottom-right') {
          lastH = newH = Math.max(340, startHeight + deltaY);
        } else if (direction === 'top') {
          lastH = newH = Math.max(340, startHeight - deltaY);
        }

        if (isTauri) {
          try {
            const win = getCurrentWindow();
            await win.setSize(new LogicalSize(Math.round(newW), Math.round(newH)));
          } catch (err) {
            console.warn('Resize error:', err);
          }
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        try {
          target.releasePointerCapture(upEvent.pointerId);
        } catch {
          // Capture may already be gone if the pointer left the window.
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        if (isTauri && lastW > 0 && lastH > 0) {
          import('../services/window').then(({ WindowService }) => {
            void WindowService.saveCurrentSize(lastW, lastH);
          });
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };
  };

  return (
    <>
      {/* Right border */}
      <div
        onPointerDown={handleResizeDrag('right')}
        className="absolute top-3 bottom-3 right-0 w-2 cursor-ew-resize hover:bg-[var(--surface)] active:bg-[var(--elevated)] z-50 transition-colors"
        title="Потяните для изменения ширины"
      />
      {/* Bottom border */}
      <div
        onPointerDown={handleResizeDrag('bottom')}
        className="absolute left-3 right-3 bottom-0 h-2 cursor-ns-resize hover:bg-[var(--surface)] active:bg-[var(--elevated)] z-50 transition-colors"
        title="Потяните для изменения высоты"
      />
      {/* Bottom-Right corner */}
      <div
        onPointerDown={handleResizeDrag('bottom-right')}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-50 flex items-end justify-end p-1 hover:bg-[var(--surface)] active:bg-[var(--elevated)] rounded-br-2xl transition-colors group"
        title="Потяните угол для свободного масштабирования"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          className="text-[var(--text-faint)] group-hover:text-[var(--text-muted)] transition-colors"
        >
          <path d="M7 1L1 7M7 4L4 7M7 7H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </>
  );
};
