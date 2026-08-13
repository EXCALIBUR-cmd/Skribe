import React, { useState, useEffect, useRef } from 'react';
import anime from 'animejs';
import { useNavigate } from 'react-router-dom';
import { ANIMATION_CONFIG, isReducedMotion } from '../../animations/config';

export const CommandPalette = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const overlayRef = useRef(null);
  const paletteRef = useRef(null);
  const navigate = useNavigate();

  const commands = [
    { label: 'Go to Welcome Screen', icon: 'home', action: () => navigate('/') },
    { label: 'Open Main Canvas', icon: 'draw', action: () => navigate('/canvas') },
    { label: 'AI Sidekick Assistant', icon: 'auto_awesome', action: () => navigate('/ai-assist') },
    { label: 'View Boards & Workspace', icon: 'dashboard', action: () => navigate('/boards') },
    { label: 'Mobile Canvas View', icon: 'smartphone', action: () => navigate('/mobile') }
  ];

  const filteredCommands = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (!isOpen) return;

    const overlay = overlayRef.current;
    const palette = paletteRef.current;

    if (!isReducedMotion() && overlay && palette) {
      anime.timeline()
        .add({
          targets: overlay,
          opacity: [0, 1],
          duration: ANIMATION_CONFIG.durations.normal,
          easing: ANIMATION_CONFIG.easings.smoothOut
        })
        .add({
          targets: palette,
          scale: [0.92, 1],
          opacity: [0, 1],
          translateY: [-15, 0],
          duration: ANIMATION_CONFIG.durations.elastic,
          easing: ANIMATION_CONFIG.easings.backOut
        }, '-=150');
    }

    setSelectedIndex(0);
  }, [isOpen]);

  const handleClose = () => {
    const overlay = overlayRef.current;
    const palette = paletteRef.current;

    if (!isReducedMotion() && overlay && palette) {
      anime.timeline({ complete: onClose })
        .add({
          targets: palette,
          scale: 0.95,
          opacity: 0,
          duration: ANIMATION_CONFIG.durations.fast,
          easing: 'easeInQuad'
        })
        .add({
          targets: overlay,
          opacity: 0,
          duration: ANIMATION_CONFIG.durations.fast,
          easing: 'easeInQuad'
        }, '-=100');
    } else {
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
        handleClose();
      }
    } else if (e.key === 'Escape') {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-start justify-center pt-24 px-4"
      onClick={handleClose}
    >
      <div
        ref={paletteRef}
        className="bg-surface border-2 border-primary rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden sticker-shadow"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="p-4 border-b-2 border-surface-variant flex items-center gap-3 bg-surface-container-low">
          <span className="material-symbols-outlined text-primary text-2xl">search</span>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="w-full bg-transparent border-none outline-none font-body text-lg text-on-surface placeholder:text-on-surface-variant/60"
          />
          <kbd className="bg-surface-container-high text-on-surface-variant text-xs font-bold px-2 py-1 rounded border border-outline-variant">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div className="p-6 text-center text-on-surface-variant font-body text-sm">
              No matching commands found.
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.label}
                  onClick={() => {
                    cmd.action();
                    handleClose();
                  }}
                  className={`flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-primary text-on-primary font-bold shadow-sm translate-x-1'
                      : 'text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined">{cmd.icon}</span>
                    <span className="font-label text-sm">{cmd.label}</span>
                  </div>
                  <span className="text-xs opacity-75 font-label">Jump to</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
