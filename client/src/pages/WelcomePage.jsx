import React, { useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import anime from 'animejs';
import { useAuth } from '../context/AuthContext';
import { isReducedMotion } from '../animations/config';
import LandingBoardDemo from '../components/landing/LandingBoardDemo';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary';
const primaryAction = `inline-flex min-h-14 items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 border-primary bg-primary px-6 font-label text-lg font-bold text-on-primary sticker-shadow btn-pressed transition-transform hover:-translate-y-0.5 cursor-pointer ${focusRing}`;
const secondaryAction = `inline-flex min-h-14 items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 border-outline bg-surface px-6 font-label text-lg font-bold text-on-surface btn-pressed transition-transform hover:-translate-y-0.5 cursor-pointer ${focusRing}`;
const card = 'rounded-[28px] border-2 border-outline-variant bg-surface p-7 flex flex-col gap-5 transition-transform duration-300 hover:-translate-y-1';
const cardTitle = 'mb-2 font-headline text-2xl font-bold text-on-surface';
const cardBody = 'font-body text-base leading-relaxed text-on-surface-variant';

const SidekickVisual = () => (
  <div className="flex flex-col gap-3 font-body text-sm" aria-hidden="true">
    <p className="m-0 self-end rounded-2xl rounded-br-sm bg-surface-container-high px-4 py-2 text-on-surface">What's still unfinished?</p>
    <p className="m-0 self-start rounded-2xl rounded-bl-sm bg-secondary-container px-4 py-2 text-on-secondary-container">Three tasks. Want them as a Kanban board?</p>
    <div className="flex items-center gap-2 self-start">
      <span className="rounded-full bg-primary px-4 py-1.5 font-label text-xs font-bold text-on-primary">Apply</span>
      <span className="rounded-full border-2 border-outline-variant px-4 py-1 font-label text-xs font-bold text-on-surface">Cancel</span>
    </div>
  </div>
);

const DiagramVisual = () => (
  <svg viewBox="0 0 420 110" className="h-auto w-full text-on-surface" fill="none" aria-hidden="true">
    <path d="M 112 55 H 158 M 262 55 H 308" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="M 150 47 L 160 55 L 150 63 M 300 47 L 310 55 L 300 63" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="8" y="26" width="104" height="58" rx="14" fill="#fff3a0" />
    <rect x="160" y="26" width="102" height="58" rx="14" fill="#79f3ea" />
    <circle cx="362" cy="55" r="44" fill="#ffb3b0" />
    <path d="M 36 55 H 84 M 188 55 H 234" stroke="#1e293b" strokeOpacity="0.6" strokeWidth="5" strokeLinecap="round" />
    <path d="M 346 56 L 358 68 L 380 44" stroke="#1e293b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const VoiceVisual = () => (
  <div className="flex h-14 items-center gap-1.5" aria-hidden="true">
    {[18, 34, 52, 26, 44, 56, 30, 48, 22, 38, 14].map((height, index) => (
      <span key={index} className={`w-2 rounded-full ${index % 3 === 0 ? 'bg-primary' : index % 3 === 1 ? 'bg-secondary' : 'bg-tertiary'}`} style={{ height }} />
    ))}
  </div>
);

const TidyVisual = () => (
  <svg viewBox="0 0 240 70" className="h-14 w-auto self-start text-on-surface" fill="none" aria-hidden="true">
    <rect x="4" y="30" width="26" height="26" rx="6" fill="#fff3a0" transform="rotate(-14 17 43)" />
    <rect x="32" y="6" width="26" height="26" rx="6" fill="#ffb3b0" transform="rotate(12 45 19)" />
    <rect x="54" y="36" width="26" height="26" rx="6" fill="#79f3ea" transform="rotate(-8 67 49)" />
    <path d="M 98 35 H 134 M 126 27 L 136 35 L 126 43" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="152" y="22" width="26" height="26" rx="6" fill="#fff3a0" />
    <rect x="182" y="22" width="26" height="26" rx="6" fill="#79f3ea" />
    <rect x="212" y="22" width="26" height="26" rx="6" fill="#ffb3b0" />
  </svg>
);

const TogetherVisual = () => (
  <svg viewBox="0 0 240 70" className="h-14 w-auto self-start" fill="none" aria-hidden="true">
    <path d="M 10 50 C 50 10, 90 62, 130 30 S 200 18, 228 44" stroke="var(--color-secondary)" strokeWidth="4" strokeLinecap="round" />
    <path d="M 60 18 L 60 42 L 66 36 L 71 47 L 76 45 L 71 34 L 80 33 Z" fill="#ffb3b0" stroke="#14161c" strokeWidth="2" strokeLinejoin="round" />
    <path d="M 168 8 L 168 32 L 174 26 L 179 37 L 184 35 L 179 24 L 188 23 Z" fill="#fff3a0" stroke="#14161c" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

export const WelcomePage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const heroRef = useRef(null);

  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero || isReducedMotion()) return undefined;
    const lines = hero.querySelectorAll('[data-rise]');
    const scribble = hero.querySelector('[data-mess-scribble]');
    const length = scribble.getTotalLength();
    scribble.setAttribute('stroke-dasharray', String(length));
    const rise = anime({ targets: lines, translateY: [28, 0], opacity: [0, 1], duration: 800, delay: anime.stagger(90), easing: 'easeOutCubic' });
    const draw = anime({ targets: scribble, strokeDashoffset: [length, 0], duration: 900, delay: 650, easing: 'easeInOutSine' });
    return () => {
      rise.pause();
      draw.pause();
      anime.remove([...lines, scribble]);
    };
  }, []);

  const startDrawing = () => navigate(user ? '/boards' : '/canvas');
  const meetSidekick = () => navigate('/ai-assist');

  return (
    <main className="relative w-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden="true"
        style={{ backgroundImage: 'radial-gradient(var(--color-outline-variant) 1.2px, transparent 1.2px)', backgroundSize: '26px 26px', opacity: 0.55 }}
      />
      <div className="pointer-events-none absolute -top-40 -left-40 h-[36rem] w-[36rem] rounded-full bg-secondary-container/30 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute top-40 -right-48 h-[40rem] w-[40rem] rounded-full bg-primary-container/15 blur-3xl" aria-hidden="true" />

      <section ref={heroRef} className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 pt-12 pb-16 lg:grid-cols-12 lg:gap-14 lg:px-10 lg:pt-20 lg:pb-24">
        <div className="lg:col-span-5">
          <p data-rise className="m-0 inline-flex items-center gap-2 rounded-full border-2 border-outline-variant bg-surface px-4 py-1.5 font-label text-sm font-bold text-on-surface">
            <span className="material-symbols-outlined text-secondary text-lg" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">auto_awesome</span>
            The whiteboard with an AI copilot
          </p>
          <h1 className="mt-6 mb-0 font-display text-[3.25rem] font-bold leading-[1.02] tracking-tight text-on-surface sm:text-7xl lg:text-[5.25rem]">
            <span data-rise className="block">Every great</span>
            <span data-rise className="block">idea starts</span>
            <span data-rise className="block">
              as a{' '}
              <span className="relative inline-block italic text-primary">
                mess.
                <svg viewBox="0 0 220 28" className="absolute -bottom-3 left-0 h-auto w-full" fill="none" aria-hidden="true">
                  <path data-mess-scribble d="M 5 16 C 45 4, 80 25, 118 12 S 180 8, 215 18" stroke="var(--color-secondary)" strokeWidth="7" strokeLinecap="round" />
                </svg>
              </span>
            </span>
          </h1>
          <p data-rise className="mt-9 mb-0 max-w-xl font-body text-lg leading-relaxed text-on-surface-variant sm:text-xl">
            Sketch it out together in real time. When you're ready, Skribe's AI reads your board, answers questions and tidies things up. Nothing changes until you say so.
          </p>
          <div data-rise className="mt-9 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={startDrawing} className={primaryAction}>
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">edit</span>
              {user ? 'Open My Boards' : 'Start Drawing'}
            </button>
            <button type="button" onClick={meetSidekick} className={secondaryAction}>
              <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              Meet AI Sidekick
            </button>
          </div>
        </div>

        <div className="lg:col-span-7">
          <LandingBoardDemo />
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-16 lg:px-10 lg:pb-24" aria-labelledby="landing-features">
        <h2 id="landing-features" className="m-0 max-w-3xl font-headline text-4xl font-bold leading-tight tracking-tight text-on-surface sm:text-5xl">
          From first scribble to a plan everyone can follow.
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-6">
          <article className={`${card} md:col-span-3`}>
            <SidekickVisual />
            <div>
              <h3 className={cardTitle}>AI Sidekick</h3>
              <p className={cardBody}>Ask about your board and get answers from what's actually on it. It prepares changes for you to preview, apply or cancel.</p>
            </div>
          </article>
          <article className={`${card} md:col-span-3`}>
            <DiagramVisual />
            <div>
              <h3 className={cardTitle}>Diagram Studio</h3>
              <p className={cardBody}>Describe a process in plain words, review the diagram it draws, and drop it onto your board.</p>
            </div>
          </article>
          <article className={`${card} md:col-span-2`}>
            <TidyVisual />
            <div>
              <h3 className={cardTitle}>Mess Cleanup</h3>
              <p className={cardBody}>Preview a tidier layout that keeps related things together, then apply it when it looks right.</p>
            </div>
          </article>
          <article className={`${card} md:col-span-2`}>
            <TogetherVisual />
            <div>
              <h3 className={cardTitle}>Draw together</h3>
              <p className={cardBody}>Share a board and see each other's cursors and changes as they happen.</p>
            </div>
          </article>
          <article className={`${card} md:col-span-2`}>
            <VoiceVisual />
            <div>
              <h3 className={cardTitle}>Voice commands</h3>
              <p className={cardBody}>Hands busy? Dictate a note or ask for a shape and it lands on the canvas.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-20 lg:px-10">
        <div className="flex flex-col items-start gap-8 rounded-[32px] border-2 border-primary bg-primary-container/25 p-8 sticker-shadow md:flex-row md:items-center md:justify-between md:p-14">
          <h2 className="m-0 font-display text-4xl font-bold leading-tight tracking-tight text-on-surface sm:text-5xl">
            Your next mess is waiting.
          </h2>
          <button type="button" onClick={startDrawing} className={`${primaryAction} shrink-0`}>
            {user ? 'Open My Boards' : 'Start Drawing'}
            <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          </button>
        </div>
      </section>
    </main>
  );
};

export default WelcomePage;
