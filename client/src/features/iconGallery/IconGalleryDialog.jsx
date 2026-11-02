import React, { useMemo, useRef, useState } from 'react';
import AnimatedModal from '../../components/ui/AnimatedModal';
import { useT } from '../../context/PreferencesContext';
import { adaptColor, isDarkSurface } from '../settings/canvasTheme.js';
import { ICON_CATEGORIES, searchIcons } from './iconCatalogue.js';
import { DEFAULT_ICON_STYLE, ICON_COLORS, ICON_SIZES, ICON_STROKES, toIconSvgMarkup } from './iconObjects.js';

const COLUMNS = 6;
const GRID_KEYS = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS, Home: -Infinity, End: Infinity };
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const OptionButton = ({ isActive, onClick, children, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={isActive}
    aria-label={label}
    className={`rounded-lg border px-2.5 py-1 text-xs font-bold cursor-pointer motion-safe:transition-colors ${FOCUS_RING} ${isActive ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'}`}
  >
    {children}
  </button>
);

export const IconGalleryDialog = ({ isOpen, onClose, onInsert, canvasBackground }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState(null);
  const [style, setStyle] = useState(DEFAULT_ICON_STYLE);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const previewRef = useRef(null);
  const gridRef = useRef(null);

  const results = useMemo(() => searchIcons(query, category), [query, category]);
  const tabStopId = results.some((icon) => icon.id === selected?.id) ? selected.id : results[0]?.id;
  const darkCanvas = isDarkSurface(canvasBackground);
  const previewColor = darkCanvas ? adaptColor(style.color, canvasBackground) : style.color;
  const updateStyle = (changes) => setStyle((current) => ({ ...current, ...changes }));

  const handleGridKey = (event) => {
    const delta = GRID_KEYS[event.key];
    if (delta === undefined || !gridRef.current) return;
    const buttons = [...gridRef.current.querySelectorAll('button[data-icon-id]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))].focus();
  };

  const handleInsert = async () => {
    if (!selected || !previewRef.current || isAdding) return;
    setIsAdding(true);
    setError('');
    try {
      await onInsert({
        markup: toIconSvgMarkup(previewRef.current, style.color),
        icon: { id: selected.id, name: selected.name, category: selected.category },
        ...style
      });
      setIsAdding(false);
      onClose();
    } catch {
      setIsAdding(false);
      setError(t('icons.insertFailed'));
    }
  };

  const SelectedIcon = selected?.Icon;

  return (
    <AnimatedModal isOpen={isOpen} onClose={onClose} title={t('icons.title')}>
      <div className="flex flex-col gap-3">
        <label htmlFor="icon-gallery-search" className="sr-only">{t('icons.searchLabel')}</label>
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant" aria-hidden="true">search</span>
          <input
            id="icon-gallery-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('icons.searchPlaceholder')}
            autoComplete="off"
            autoFocus
            className={`w-full rounded-xl border border-outline-variant bg-surface-container-low py-2 pl-10 pr-3 text-sm text-on-surface placeholder:text-on-surface-variant ${FOCUS_RING}`}
          />
        </div>

        <div role="group" aria-label={t('icons.categoriesLabel')} className="flex gap-1.5 overflow-x-auto pb-1">
          {[{ id: 'all', labelKey: 'icons.category.all' }, ...ICON_CATEGORIES].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              aria-pressed={category === item.id}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold cursor-pointer motion-safe:transition-colors ${FOCUS_RING} ${category === item.id ? 'border-primary bg-primary-container text-on-primary-container' : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'}`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>

        <p className="sr-only" aria-live="polite">{t('icons.resultCount', { count: results.length })}</p>

        {results.length > 0 ? (
          <div
            ref={gridRef}
            role="group"
            aria-label={t('icons.gridLabel')}
            onKeyDown={handleGridKey}
            className={`grid grid-cols-6 gap-1.5 overflow-y-auto p-0.5 ${selected ? 'max-h-40' : 'max-h-56'}`}
          >
            {results.map(({ id, name, Icon, ...rest }) => {
              const isSelected = selected?.id === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-icon-id={id}
                  tabIndex={id === tabStopId ? 0 : -1}
                  title={name}
                  aria-label={name}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelected({ id, name, Icon, ...rest });
                    setError('');
                  }}
                  className={`relative flex aspect-square items-center justify-center rounded-xl border-2 cursor-pointer motion-safe:transition-colors ${FOCUS_RING} ${isSelected ? 'border-primary bg-primary-container text-on-primary-container' : 'border-transparent bg-surface-container-low text-on-surface hover:border-outline-variant hover:bg-surface-container-high'}`}
                >
                  <Icon size={24} strokeWidth={2} aria-hidden="true" />
                  {isSelected && <span className="material-symbols-outlined absolute right-0.5 top-0.5 text-sm text-primary" aria-hidden="true">check_circle</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant" aria-hidden="true">search_off</span>
            <p className="text-sm text-on-surface-variant">{query.trim() ? t('icons.noResults', { query: query.trim() }) : t('icons.emptyCategory')}</p>
            {query.trim() && (
              <button type="button" onClick={() => setQuery('')} className={`rounded-full border border-outline-variant px-3 py-1 text-xs font-bold text-on-surface cursor-pointer hover:bg-surface-container-high ${FOCUS_RING}`}>
                {t('icons.clearSearch')}
              </button>
            )}
          </div>
        )}

        {SelectedIcon ? (
          <div className="flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-3 sm:flex-row">
            <div
              className="flex h-24 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-outline-variant sm:h-28 sm:w-28"
              style={{ background: canvasBackground || '#ffffff' }}
              role="img"
              aria-label={t('icons.preview', { name: selected.name })}
            >
              <SelectedIcon ref={previewRef} size={style.size} color={previewColor} strokeWidth={style.strokeWidth} aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <p className="truncate text-sm font-bold text-on-surface">{selected.name}</p>
              <div role="group" aria-label={t('icons.colour')} className="flex flex-wrap items-center gap-1.5">
                {ICON_COLORS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => updateStyle({ color: option.value })}
                    aria-pressed={style.color === option.value}
                    aria-label={t(`icons.color.${option.id}`)}
                    title={t(`icons.color.${option.id}`)}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 cursor-pointer ${FOCUS_RING} ${style.color === option.value ? 'border-on-surface' : 'border-transparent'}`}
                    style={{ background: option.value }}
                  >
                    {style.color === option.value && <span className="material-symbols-outlined text-sm text-white" aria-hidden="true">check</span>}
                  </button>
                ))}
                <label className={`relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-outline-variant ${ICON_COLORS.some((option) => option.value === style.color) ? '' : 'ring-2 ring-on-surface'}`} title={t('icons.customColour')}>
                  <span className="material-symbols-outlined text-sm text-on-surface-variant" aria-hidden="true">colorize</span>
                  <input
                    type="color"
                    value={style.color}
                    onChange={(event) => updateStyle({ color: event.target.value })}
                    aria-label={t('icons.customColour')}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </div>
              <div role="group" aria-label={t('icons.size')} className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 text-xs font-bold text-on-surface-variant">{t('icons.size')}</span>
                {ICON_SIZES.map((option) => (
                  <OptionButton key={option.id} isActive={style.size === option.size} onClick={() => updateStyle({ size: option.size })} label={`${t(`icons.size.${option.id}`)}, ${option.size} px`}>
                    {option.size}
                  </OptionButton>
                ))}
              </div>
              <div role="group" aria-label={t('icons.stroke')} className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 text-xs font-bold text-on-surface-variant">{t('icons.stroke')}</span>
                {ICON_STROKES.map((option) => (
                  <OptionButton key={option.id} isActive={style.strokeWidth === option.value} onClick={() => updateStyle({ strokeWidth: option.value })}>
                    {t(`icons.stroke.${option.id}`)}
                  </OptionButton>
                ))}
              </div>
            </div>
          </div>
        ) : (
          results.length > 0 && <p className="text-center text-xs text-on-surface-variant">{t('icons.selectPrompt')}</p>
        )}

        {error && <p role="alert" className="text-sm text-error">{error}</p>}

        <button
          type="button"
          onClick={handleInsert}
          disabled={!selected || isAdding}
          aria-busy={isAdding}
          className={`self-end rounded-full bg-primary px-5 py-2 font-bold text-on-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          {isAdding ? t('icons.adding') : t('icons.add')}
        </button>
      </div>
    </AnimatedModal>
  );
};

export default IconGalleryDialog;
