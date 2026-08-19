import React from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from './Header';
import { FloatingNavBar } from './FloatingNavBar';

export const AppLayout = ({ children }) => {
  const { pathname } = useLocation();
  const isCanvasRoute = pathname === '/canvas' || pathname.startsWith('/board/');

  return (
    <div className="min-h-screen flex flex-col relative bg-background text-on-background overflow-x-hidden">
      <Header />

      <main className={`flex-1 flex flex-col relative z-10 ${isCanvasRoute ? 'overflow-hidden' : 'pb-28'}`}>
        {children}
      </main>

      <FloatingNavBar />
    </div>
  );
};

export default AppLayout;
