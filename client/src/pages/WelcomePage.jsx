import React from 'react';
import { useNavigate } from 'react-router-dom';

export const WelcomePage = () => {
  const navigate = useNavigate();

  return (
    <main className="w-full max-w-4xl mx-auto px-10 flex flex-col items-center justify-center relative z-10 min-h-[calc(100vh-140px)] py-8">
      <div className="relative mb-8 w-64 h-64 md:w-80 md:h-80 animate-bounce-slight flex items-center justify-center">
        <img
          className="w-full h-full object-contain drop-shadow-xl"
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuCdjSA9QrAYeufvp2HXo1HNpuHXPcFdC97t-EDmQ131hDhXKq8qvsuCBY3nWXAXeCLZ20DCkUhKr2Kvs09pEIktgOdq31jWE1FMY9ldFdrqTVecclZLBTsBrxn1Ty7RtCvuLvayfn36ghD9vY_wcwRHDvKnpz-8MCxY76aORjOk_fUJpyF044uFoqRzB4JC8ijjT9SLo_ajeAhLY6hiDHaKDwHdajgLlb0AU3v_epVcXEoErPvuprB4"
          alt="Playful 3D character with giant yellow pencil"
        />
        <div className="absolute -top-4 -right-4 w-12 h-12 bg-tertiary-fixed rounded-full flex items-center justify-center animate-wiggle sticker-shadow border-2 border-outline-variant rotate-12">
          <span className="material-symbols-outlined text-on-tertiary-fixed">star</span>
        </div>
        <div
          className="absolute bottom-8 -left-6 w-10 h-10 bg-secondary-fixed rounded-full flex items-center justify-center animate-wiggle sticker-shadow border-2 border-outline-variant -rotate-12"
          style={{ animationDelay: '0.5s' }}
        >
          <span className="material-symbols-outlined text-on-secondary-fixed">favorite</span>
        </div>
      </div>

      <div className="text-center max-w-2xl mb-12">
        <h1 className="font-display text-5xl md:text-6xl text-primary mb-4 italic tracking-tighter font-bold">
          Skribe
        </h1>
        <h2 className="font-headline text-2xl md:text-3xl text-on-surface mb-2 font-bold">
          Your canvas is a blank slate
        </h2>
        <p className="font-body text-lg text-on-surface-variant max-w-xl mx-auto">
          Let's make some magic! Start drawing, try our AI features, or grab a template to kickstart your ideas.
        </p>
      </div>

      {/* Quick Actions (Bento Layout) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-3xl mb-8">
        {/* Action 1: Start Drawing */}
        <button
          onClick={() => navigate('/canvas')}
          className="group flex flex-col items-center justify-center p-6 bg-primary text-on-primary rounded-xl border-2 border-primary sticker-shadow btn-pressed transition-all relative overflow-hidden cursor-pointer"
        >
          <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="material-symbols-outlined text-4xl mb-3" style={{ fontVariationSettings: "'FILL' 1" }}>
            edit
          </span>
          <span className="font-label text-base font-bold">Start Drawing</span>
        </button>

        {/* Action 2: AI Sketch */}
        <button
          onClick={() => navigate('/ai-assist')}
          className="group flex flex-col items-center justify-center p-6 bg-secondary-container text-on-secondary-container rounded-xl border-2 border-secondary sticker-shadow btn-pressed transition-all hover:bg-secondary-fixed-dim cursor-pointer"
        >
          <span className="material-symbols-outlined text-4xl mb-3">auto_awesome</span>
          <span className="font-label text-base font-bold">Try AI Sketch</span>
        </button>

        {/* Action 3: Explore Templates */}
        <button
          onClick={() => navigate('/boards')}
          className="group flex flex-col items-center justify-center p-6 bg-tertiary-container text-on-tertiary-container rounded-xl border-2 border-tertiary sticker-shadow btn-pressed transition-all hover:bg-tertiary-fixed cursor-pointer"
        >
          <span className="material-symbols-outlined text-4xl mb-3">category</span>
          <span className="font-label text-base font-bold">Explore Templates</span>
        </button>
      </div>

      {/* Contextual Nudges pointing to bottom */}
      <div className="flex flex-col items-center animate-bounce text-primary hidden md:flex mt-2">
        <span className="font-label text-sm font-bold italic mb-2">Tools down here!</span>
        <svg
          className="filter drop-shadow-[2px_2px_0px_rgba(174,47,52,0.2)]"
          fill="none"
          height="60"
          viewBox="0 0 40 60"
          width="40"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M20 5V55M20 55L5 40M20 55L35 40"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
          />
        </svg>
      </div>
    </main>
  );
};

export default WelcomePage;
