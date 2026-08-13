import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export const FloatingNavBar = ({ isWheelOpen = false }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { label: 'Home', icon: 'home', path: '/' },
    { label: 'Boards', icon: 'dashboard', path: '/boards' },
    { label: 'AI Assist', icon: 'auto_awesome', path: '/ai-assist' },
    { label: 'Mobile', icon: 'smartphone', path: '/mobile' }
  ];

  return (
    <nav
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full px-6 py-1.5 border-2 border-primary sticker-shadow-dock bg-surface/80 dark:bg-inverse-surface/90 backdrop-blur-lg flex items-center gap-6 z-40 transition-all duration-300 ${
        isWheelOpen ? 'opacity-40 blur-xs pointer-events-none' : ''
      }`}
    >
      {navItems.map((item) => {
        const isActive = location.pathname === item.path || (item.path === '/' && location.pathname === '/canvas');
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`flex flex-col items-center justify-center p-2.5 transition-transform hover:scale-110 active:translate-y-1 cursor-pointer ${
              isActive ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className={`material-symbols-outlined text-xl ${isActive ? 'text-primary' : ''}`}>
              {item.icon}
            </span>
            <span className="font-label text-[11px] mt-0.5 hidden md:block">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default FloatingNavBar;
