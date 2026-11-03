import React, { useEffect, useRef, useState } from 'react';
import anime from 'animejs';
import { isReducedMotion } from '../../animations/config';

const YELLOW = '#fff3a0';
const TURQUOISE = '#79f3ea';
const PINK = '#ffb3b0';
const NOTE_W = 176;
const NOTE_H = 112;

const NOTES = [
  { lines: ['Dark mode', 'for night owls'], fill: YELLOW, mess: { x: 58, y: 108, r: -9 }, clean: { x: 44, y: 148 } },
  { lines: ['Beta invite', 'list'], fill: PINK, mess: { x: 300, y: 96, r: 6 }, clean: { x: 556, y: 148 } },
  { lines: ['Onboarding', 'walkthrough'], fill: TURQUOISE, mess: { x: 548, y: 132, r: -5 }, clean: { x: 300, y: 148 } },
  { lines: ['Voice notes', 'on boards'], fill: YELLOW, mess: { x: 148, y: 322, r: 7 }, clean: { x: 44, y: 280 } },
  { lines: ['Share links', 'with one click'], fill: TURQUOISE, mess: { x: 392, y: 300, r: -8 }, clean: { x: 300, y: 280 } },
  { lines: ['Landing page', 'launch'], fill: PINK, mess: { x: 586, y: 340, r: 10 }, clean: { x: 556, y: 280 } }
];

const COLUMNS = [
  { label: 'Ideas', x: 44 },
  { label: 'Building', x: 300 },
  { label: 'Shipped', x: 556 }
];

const CURSOR_PATH = 'M 0 0 L 0 26 L 7 20 L 12 31 L 18 28 L 13 17 L 23 16 Z';

export const LandingBoardDemo = () => {
  const stageRef = useRef(null);
  const motionRef = useRef([]);
  const [canAnimate] = useState(() => !isReducedMotion());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const root = stageRef.current;
    if (!root) return undefined;

    const noteEls = NOTES.map((_, index) => root.querySelector(`[data-note="${index}"]`));
    const pick = (name) => root.querySelector(`[data-demo="${name}"]`);
    const placeNote = (el, state) => el.setAttribute('transform', `translate(${state.x} ${state.y}) rotate(${state.r} ${NOTE_W / 2} ${NOTE_H / 2})`);

    if (!canAnimate) {
      NOTES.forEach((note, index) => placeNote(noteEls[index], { ...note.clean, r: 0 }));
      return undefined;
    }

    const states = NOTES.map((note) => ({ ...note.mess }));
    const reveal = { opacity: 0, scribble: 1, press: 1 };
    const assistant = { x: 600, y: 410 };
    const maya = { x: 130, y: 396 };
    const sam = { x: 470, y: 38 };
    const placeCursor = (name, state) => pick(name).setAttribute('transform', `translate(${state.x} ${state.y})`);

    const render = () => {
      states.forEach((state, index) => placeNote(noteEls[index], state));
      pick('columns').setAttribute('opacity', reveal.opacity);
      pick('scribble').setAttribute('opacity', reveal.scribble);
      pick('button').setAttribute('transform', `translate(648 18) scale(${reveal.press})`);
      placeCursor('assistant', assistant);
    };
    render();

    const toClean = NOTES.map((note) => ({ x: note.clean.x, y: note.clean.y, r: 0 }));
    const timeline = anime.timeline({ loop: true, autoplay: true, update: render });
    timeline
      .add({ targets: assistant, x: 656, y: 44, duration: 1000, easing: 'easeInOutCubic' }, 900)
      .add({ targets: reveal, press: [1, 0.92], duration: 110, easing: 'easeOutQuad' }, 1950)
      .add({ targets: reveal, press: 1, duration: 170, easing: 'easeOutBack' }, 2060)
      .add({ targets: reveal, scribble: 0, duration: 260, easing: 'linear' }, 2100);
    states.forEach((state, index) => {
      timeline.add({ targets: state, ...toClean[index], duration: 780, easing: 'easeOutBack' }, 2150 + index * 80);
    });
    timeline
      .add({ targets: reveal, opacity: 1, duration: 420, easing: 'easeOutQuad' }, 2800)
      .add({ targets: assistant, x: 600, y: 410, duration: 1100, easing: 'easeInOutCubic' }, 3300)
      .add({ targets: reveal, opacity: 0, duration: 300, easing: 'linear' }, 6800);
    states.forEach((state, index) => {
      const { x, y, r } = NOTES[index].mess;
      timeline.add({ targets: state, x, y, r, duration: 1000, easing: 'easeInOutCubic' }, 6950 + index * 40);
    });
    timeline
      .add({ targets: reveal, scribble: 1, duration: 400, easing: 'linear' }, 7900);

    const wander = (state, name, to, duration) => anime({
      targets: state,
      ...to,
      duration,
      direction: 'alternate',
      loop: true,
      easing: 'easeInOutSine',
      update: () => placeCursor(name, state)
    });
    const mayaLoop = wander(maya, 'maya', { x: 340, y: 412 }, 3100);
    const samLoop = wander(sam, 'sam', { x: 590, y: 44 }, 4300);

    motionRef.current = [timeline, mayaLoop, samLoop];
    return () => {
      motionRef.current.forEach((animation) => animation.pause());
      motionRef.current = [];
      anime.remove([...states, reveal, assistant, maya, sam]);
    };
  }, [canAnimate]);

  const togglePaused = () => {
    motionRef.current.forEach((animation) => (paused ? animation.play() : animation.pause()));
    setPaused(!paused);
  };

  const handleTilt = (event) => {
    if (!canAnimate || event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    event.currentTarget.style.transform = `perspective(1400px) rotateY(${x * 5}deg) rotateX(${y * -5}deg)`;
  };

  const resetTilt = (event) => {
    event.currentTarget.style.transform = '';
  };

  return (
    <figure className="relative m-0 w-full">
      <div
        onPointerMove={handleTilt}
        onPointerLeave={resetTilt}
        className="rounded-[28px] border-2 border-outline-variant bg-surface overflow-hidden sticker-shadow transition-transform duration-300 ease-out"
      >
        <svg ref={stageRef} viewBox="0 0 776 480" className="block h-auto w-full text-on-surface" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <pattern id="landing-dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.4" fill="currentColor" fillOpacity="0.16" />
            </pattern>
          </defs>
          <rect width="776" height="480" fill="url(#landing-dots)" />

          <text x="28" y="48" fill="currentColor" fontFamily="Quicksand, sans-serif" fontSize="24" fontWeight="700">Launch plan</text>
          <circle cx="196" cy="40" r="15" fill={PINK} />
          <circle cx="218" cy="40" r="15" fill={TURQUOISE} />

          <g data-demo="button" transform="translate(648 18)">
            <rect width="110" height="44" rx="22" fill="currentColor" />
            <path d="M 22 13 L 25 20 L 32 23 L 25 26 L 22 33 L 19 26 L 12 23 L 19 20 Z" fill={YELLOW} />
            <text x="40" y="29" fill="var(--color-surface)" fontFamily="Quicksand, sans-serif" fontSize="16" fontWeight="700">Tidy up</text>
          </g>

          <g data-demo="columns" opacity={canAnimate ? 0 : 1}>
            {COLUMNS.map((column) => (
              <g key={column.label}>
                <text x={column.x + 4} y="128" fill="currentColor" fontFamily="Quicksand, sans-serif" fontSize="20" fontWeight="700">{column.label}</text>
                <path d={`M ${column.x + NOTE_W / 2} 260 V 280`} stroke="currentColor" strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 7" />
              </g>
            ))}
            <path d="M 220 204 H 300 M 476 204 H 556" stroke="currentColor" strokeOpacity="0.45" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 8" />
          </g>

          {NOTES.map((note, index) => (
            <g key={note.lines[0]} data-note={index}>
              <rect x="4" y="7" width={NOTE_W} height={NOTE_H} rx="14" fill="#000000" fillOpacity="0.12" />
              <rect width={NOTE_W} height={NOTE_H} rx="14" fill={note.fill} />
              <text x="16" y="44" fill="#1e293b" fontFamily="Quicksand, sans-serif" fontSize="21" fontWeight="700">{note.lines[0]}</text>
              <text x="16" y="72" fill="#1e293b" fillOpacity="0.72" fontFamily="Quicksand, sans-serif" fontSize="17" fontWeight="600">{note.lines[1]}</text>
            </g>
          ))}

          <path
            data-demo="scribble"
            d="M 300 262 C 372 228, 500 244, 508 306 C 516 370, 372 396, 322 354 C 276 316, 318 262, 396 256"
            stroke="var(--color-secondary)"
            strokeWidth="5"
            strokeLinecap="round"
            opacity={canAnimate ? 1 : 0}
          />

          <g data-demo="maya" transform="translate(130 396)">
            <path d={CURSOR_PATH} fill={PINK} stroke="#14161c" strokeWidth="2" strokeLinejoin="round" />
            <rect x="20" y="28" width="60" height="26" rx="13" fill={PINK} />
            <text x="33" y="46" fill="#14161c" fontFamily="Quicksand, sans-serif" fontSize="15" fontWeight="700">Maya</text>
          </g>

          <g data-demo="sam" transform="translate(470 38)">
            <path d={CURSOR_PATH} fill={TURQUOISE} stroke="#14161c" strokeWidth="2" strokeLinejoin="round" />
            <rect x="20" y="28" width="54" height="26" rx="13" fill={TURQUOISE} />
            <text x="33" y="46" fill="#14161c" fontFamily="Quicksand, sans-serif" fontSize="15" fontWeight="700">Sam</text>
          </g>

          <g data-demo="assistant" transform="translate(600 410)">
            <path d={CURSOR_PATH} fill={YELLOW} stroke="#14161c" strokeWidth="2" strokeLinejoin="round" />
            <rect x="20" y="28" width="96" height="26" rx="13" fill={YELLOW} />
            <text x="33" y="46" fill="#14161c" fontFamily="Quicksand, sans-serif" fontSize="15" fontWeight="700">AI Sidekick</text>
          </g>
        </svg>
      </div>

      <figcaption className="mt-5 flex items-center justify-between gap-4 font-label text-sm text-on-surface-variant">
        <span>Illustration of a Skribe board being tidied into columns.</span>
        {canAnimate && (
          <button
            type="button"
            onClick={togglePaused}
            aria-label={paused ? 'Play animation' : 'Pause animation'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-outline-variant bg-surface text-on-surface cursor-pointer hover:border-primary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined" aria-hidden="true">{paused ? 'play_arrow' : 'pause'}</span>
          </button>
        )}
      </figcaption>
    </figure>
  );
};

export default LandingBoardDemo;
