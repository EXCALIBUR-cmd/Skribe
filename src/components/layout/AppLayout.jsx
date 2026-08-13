import React from 'react';
import { Header } from './Header';
import { FloatingNavBar } from './FloatingNavBar';


export const AppLayout = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col relative bg-background text-on-background overflow-x-hidden">
      <Header />
      
      <main className="flex-1 flex flex-col relative z-10 pb-28">
        {children}
      </main>

      <FloatingNavBar />
    </div>
  );
};

export default AppLayout;
