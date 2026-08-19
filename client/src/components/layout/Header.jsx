import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';

export const Header = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isHidden, setIsHidden] = useState(false);

  const isCanvasRoute = location.pathname === '/canvas' || location.pathname.startsWith('/board/');

  useEffect(() => {
    if (!isCanvasRoute) {
      setIsHidden(false);
      return undefined;
    }

    let lastScrollY = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY) setIsHidden(true);
      if (currentScrollY < lastScrollY) setIsHidden(false);
      lastScrollY = currentScrollY;
    };

    const handleWheel = (event) => {
      if (event.deltaY > 0) setIsHidden(true);
      if (event.deltaY < 0) setIsHidden(false);
    };

    const handlePointerMove = (event) => {
      if (event.clientY <= 32) setIsHidden(false);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [isCanvasRoute]);

  return (
    <header
      className={`w-full h-16 px-6 border-b border-surface-variant bg-surface/90 backdrop-blur-md flex items-center justify-between z-40 sticky top-0 transition-[transform,opacity] duration-300 ease-out will-change-transform ${
        isCanvasRoute && isHidden ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
      }`}
    >
      <div className="flex items-center gap-3">
        <Link to={user ? "/boards" : "/"} className="flex items-center gap-2 group">
          <span className="material-symbols-outlined text-primary text-3xl font-bold transition-transform group-hover:rotate-12">
            draw
          </span>
          <h1 className="font-display font-bold text-2xl text-primary tracking-tight italic">
            Skribe
          </h1>
        </Link>
        <span className="bg-primary-fixed text-on-primary-fixed-variant text-xs font-semibold px-2.5 py-0.5 rounded-full border border-primary/20 ml-2 hidden sm:inline-block">
          Canvas OS
        </span>
      </div>

      <div className="flex items-center gap-3">
        {user ? (
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-on-surface-variant hidden md:inline-block">
              {user.email}
            </span>
            <button
              onClick={() => navigate('/boards')}
              className="bg-surface-container hover:bg-surface-container-high border-2 border-outline rounded-full px-3.5 py-1.5 font-label text-xs font-bold text-on-surface transition-all cursor-pointer flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">dashboard</span>
              <span>Boards</span>
            </button>
            <button
              onClick={logout}
              className="bg-error-container/40 text-on-error-container hover:bg-error-container text-xs font-bold px-3 py-1.5 rounded-full border border-error/20 transition-all cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-base">logout</span>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              to="/signin"
              className="px-4 py-2 font-label text-xs font-bold text-primary hover:text-secondary transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/signup"
              className="bg-primary text-on-primary font-label text-xs font-bold px-4 py-2 rounded-full border-2 border-on-primary-fixed shadow-sm hover:scale-105 transition-all"
            >
              Sign Up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
