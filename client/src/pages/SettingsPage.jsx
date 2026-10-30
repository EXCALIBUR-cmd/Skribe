import React, { useEffect, useRef } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import {
  SETTINGS_CATEGORIES,
  DEFAULT_SETTINGS_CATEGORY_ID,
  getSettingsCategory
} from '../features/settings/settingsCategories';

export const SettingsPage = () => {
  const { categoryId } = useParams();
  const category = getSettingsCategory(categoryId);
  const activeLinkRef = useRef(null);

  useEffect(() => {
    activeLinkRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [categoryId]);

  if (!category) {
    return <Navigate to={`/settings/${DEFAULT_SETTINGS_CATEGORY_ID}`} replace />;
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
      <header className="mb-6 md:mb-8">
        <h1 className="font-headline text-3xl font-bold text-on-surface">Settings</h1>
        <p className="font-body text-sm text-on-surface-variant mt-1">
          Manage how Skribe looks, behaves and works for you.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-6 md:gap-10">
        <nav aria-label="Settings categories" className="md:w-60 shrink-0">
          <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:sticky md:top-24 [scrollbar-width:none]">
            {SETTINGS_CATEGORIES.map((item) => (
              <li key={item.id} className="shrink-0">
                <NavLink
                  to={`/settings/${item.id}`}
                  ref={item.id === category.id ? activeLinkRef : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 h-10 px-3 rounded-[12px] font-label text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      isActive
                        ? 'bg-secondary-container text-on-secondary-container font-bold'
                        : 'font-semibold text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                    }`
                  }
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-labelledby="settings-category-title" className="flex-1 min-w-0">
          <h2 id="settings-category-title" className="font-headline text-xl font-bold text-on-surface">
            {category.label}
          </h2>
          <p className="font-body text-sm text-on-surface-variant mt-1">{category.description}</p>
          <div className="mt-6 pt-6 border-t border-outline-variant/60">
            <p className="font-body text-sm text-on-surface-variant">
              No {category.label} preferences are available yet.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;
