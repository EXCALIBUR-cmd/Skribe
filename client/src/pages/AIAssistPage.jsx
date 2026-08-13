import React, { useState } from 'react';
import AIPanelWrapper from '../components/ui/AIPanelWrapper';

export const AIAssistPage = () => {
  const [sketchToShape, setSketchToShape] = useState(true);
  const [promptInput, setPromptInput] = useState('');

  return (
    <div className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-surface-bright flex">
      <div
        className="absolute inset-0 w-full h-full p-10 flex justify-center items-center z-0"
        style={{
          backgroundImage: 'radial-gradient(circle, #dce3f0 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      >
        <div className="relative w-3/4 h-3/4 max-w-4xl border-2 border-dashed border-tertiary-container rounded-xl p-8 bg-surface/50 backdrop-blur-sm opacity-80">
          <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-secondary-container rounded-lg rotate-3 shadow-lg border-2 border-secondary flex items-center justify-center">
            <span className="font-label text-sm font-bold text-on-secondary-container">User Flow</span>
          </div>
          <svg className="absolute top-[35%] left-[45%] w-32 h-16" viewBox="0 0 100 50">
            <path d="M 0 25 Q 50 0 100 25" fill="none" stroke="#ae2f34" strokeDasharray="5,5" strokeWidth="3" />
            <polygon fill="#ae2f34" points="95,20 100,25 95,30" />
          </svg>
          <div className="absolute top-1/2 right-1/4 w-40 h-40 bg-tertiary-container rounded-full -rotate-6 shadow-lg border-2 border-tertiary flex flex-col items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-on-tertiary-container mb-2">database</span>
            <span className="font-label text-sm font-bold text-on-tertiary-container">Data Model</span>
          </div>
        </div>
      </div>

      <aside className="hidden md:flex flex-col gap-4 absolute left-6 top-1/2 -translate-y-1/2 z-10 bg-surface rounded-full p-2 border-2 border-outline-variant sticker-shadow">
        {[
          { icon: 'mouse', label: 'Select' },
          { icon: 'edit', label: 'Draw' },
          { icon: 'category', label: 'Shapes' },
          { icon: 'sticky_note_2', label: 'Sticky' }
        ].map((item, idx) => (
          <button
            key={idx}
            className="p-3 rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors group relative cursor-pointer"
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="absolute left-full ml-4 px-2 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity">
              {item.label}
            </span>
          </button>
        ))}
      </aside>

      <div className="absolute right-6 top-6 bottom-6 w-[360px] z-20">
        <AIPanelWrapper title="AI Sidekick" icon="auto_awesome" className="h-full">
          <div className="stagger-item bg-secondary-container/30 rounded-lg p-4 border-l-4 border-secondary">
            <p className="font-body text-base text-on-surface font-semibold">What are we creating today?</p>
            <p className="font-body text-xs text-on-surface-variant mt-1">I can help sketch, organize, or suggest ideas.</p>
          </div>

          <div className="stagger-item flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary">gesture</span>
                <span className="font-label text-sm font-bold text-on-surface">Sketch to Shape</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={sketchToShape}
                  onChange={(e) => setSketchToShape(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary" />
              </label>
            </div>
            <p className="font-body text-xs text-on-surface-variant">
              Automatically refine rough drawings into perfect geometric shapes as you draw.
            </p>
          </div>

          <hr className="stagger-item border-t-2 border-surface-container" />

          <div className="stagger-item flex flex-col gap-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-tertiary">lightbulb</span>
              <span className="font-label text-sm font-bold text-on-surface">Smart Suggestions</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="aspect-square bg-surface-container hover:bg-primary-container/20 rounded-lg border-2 border-transparent hover:border-primary cursor-pointer flex flex-col items-center justify-center gap-1 transition-all group p-2 text-center">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant group-hover:text-primary transition-colors">
                  group_add
                </span>
                <span className="font-label text-[10px] font-bold">User Persona</span>
              </div>
              <div className="aspect-square bg-surface-container hover:bg-secondary-container/40 rounded-lg border-2 border-transparent hover:border-secondary cursor-pointer flex flex-col items-center justify-center gap-1 transition-all group p-2 text-center">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant group-hover:text-secondary transition-colors">
                  account_tree
                </span>
                <span className="font-label text-[10px] font-bold">Flowchart</span>
              </div>
              <div className="aspect-square bg-surface-container hover:bg-tertiary-container/30 rounded-lg border-2 border-transparent hover:border-tertiary cursor-pointer flex flex-col items-center justify-center gap-1 transition-all group p-2 text-center">
                <span className="material-symbols-outlined text-3xl text-on-surface-variant group-hover:text-tertiary transition-colors">
                  view_kanban
                </span>
                <span className="font-label text-[10px] font-bold">Kanban</span>
              </div>
            </div>
          </div>

          <hr className="stagger-item border-t-2 border-surface-container" />

          <button className="stagger-item w-full bg-primary text-on-primary font-label text-sm font-bold py-4 rounded-xl shadow-md hover:scale-102 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer">
            <span className="material-symbols-outlined">grid_view</span>
            Auto-Layout Canvas
          </button>

          <div className="stagger-item mt-auto p-2 bg-surface-container-lowest border-t-2 border-surface-container rounded-xl">
            <div className="relative flex items-center bg-surface-container rounded-full border-2 border-transparent focus-within:border-primary transition-colors pr-2">
              <span className="material-symbols-outlined text-on-surface-variant ml-3 mr-2">chat</span>
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Ask AI to draw..."
                className="bg-transparent border-none outline-none text-on-surface w-full font-body text-xs py-2.5 placeholder:text-on-surface-variant"
              />
              <button className="w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center hover:bg-on-primary-container transition-colors cursor-pointer">
                <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>
                  arrow_upward
                </span>
              </button>
            </div>
          </div>
        </AIPanelWrapper>
      </div>
    </div>
  );
};

export default AIAssistPage;
