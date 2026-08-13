import React from 'react';

export const MobileCanvasPage = () => {
  return (
    <div className="w-full flex flex-col items-center justify-center p-6 min-h-[calc(100vh-64px)]">
      <div className="w-[360px] h-[720px] border-4 border-outline rounded-[3rem] bg-surface p-4 flex flex-col items-center justify-between sticker-shadow relative overflow-hidden shadow-2xl">
        <div className="w-28 h-4 bg-outline-variant rounded-full mb-2 z-30" />

        <div className="w-full h-full relative rounded-2xl overflow-hidden bg-background border border-surface-variant p-4">
          <div className="absolute top-[28%] left-[15%] z-20 animate-bounce flex items-start pointer-events-none">
            <svg
              className="text-secondary-container transform -rotate-12"
              fill="none"
              height="24"
              viewBox="0 0 24 24"
              width="24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5.5 3L19 12L12 14L9 21L5.5 3Z" fill="currentColor" stroke="white" strokeWidth="2" />
            </svg>
            <div className="bg-secondary-container text-on-secondary-container font-label text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm ml-1 mt-3">
              Mike
            </div>
          </div>

          <div className="absolute top-[58%] right-[15%] z-20 animate-pulse flex items-start pointer-events-none">
            <svg
              className="text-primary transform rotate-12"
              fill="none"
              height="24"
              viewBox="0 0 24 24"
              width="24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5.5 3L19 12L12 14L9 21L5.5 3Z" fill="currentColor" stroke="white" strokeWidth="2" />
            </svg>
            <div className="bg-primary text-on-primary font-label text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm ml-1 mt-3">
              Sarah
            </div>
          </div>

          <div className="absolute top-[20%] left-[8%] w-36 h-36 bg-tertiary-fixed-dim rounded-lg p-3 shadow-md transform rotate-3 flex flex-col cursor-grab active:cursor-grabbing hover:scale-105 transition-transform z-10 border border-black/5">
            <div className="font-headline text-sm font-bold text-on-tertiary-fixed leading-tight">
              Brainstorming Session
            </div>
            <div className="mt-auto flex -space-x-2">
              <div className="w-5 h-5 rounded-full bg-secondary-container border border-white" />
              <div className="w-5 h-5 rounded-full bg-primary-container border border-white" />
            </div>
          </div>

          <div className="absolute top-[48%] left-[30%] w-40 h-40 bg-secondary-fixed rounded-lg p-3 shadow-md transform -rotate-2 flex flex-col cursor-grab active:cursor-grabbing hover:scale-105 transition-transform z-10 border border-black/5">
            <div className="font-body text-xs text-on-secondary-fixed">
              Don't forget to review the new user flow diagrams for the mobile app before Friday!
            </div>
          </div>

          {/* Drawn Shape Circle */}
          <div className="absolute top-[18%] right-[8%] w-28 h-28 border-4 border-primary rounded-full opacity-60 transform rotate-12 pointer-events-none border-dashed" />
        </div>

        {/* Mobile Bottom Bar Accent Indicator */}
        <div className="w-32 h-1 bg-outline-variant rounded-full mt-3 z-30" />
      </div>
    </div>
  );
};

export default MobileCanvasPage;
