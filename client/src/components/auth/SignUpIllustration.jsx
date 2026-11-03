import React, { useEffect, useRef } from 'react';
import anime from 'animejs';
import { isReducedMotion } from '../../animations/config';

const STROKE_PATH = 'M 96 318 C 140 268, 176 356, 224 312 S 306 268, 352 320';
const hoverGroup = 'transition-transform duration-300 ease-out';
const hoverBox = { transformBox: 'fill-box', transformOrigin: 'center' };

export const SignUpIllustration = () => {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || isReducedMotion()) return undefined;

    const pick = (name) => root.querySelector(`[data-art="${name}"]`);
    const stroke = pick('stroke');
    const link = pick('link');
    const path = anime.path(stroke);
    const targets = [pick('note'), pick('noteSmall'), pick('star'), pick('cursor'), pick('pencil'), stroke, link];

    const note = anime({ targets: pick('note'), translateY: [-5, 6], rotate: [-1.5, 1.5], duration: 3400, direction: 'alternate', loop: true, easing: 'easeInOutSine' });
    const noteSmall = anime({ targets: pick('noteSmall'), translateY: [4, -4], duration: 4300, delay: 700, direction: 'alternate', loop: true, easing: 'easeInOutSine' });

    const star = anime.timeline({ targets: pick('star'), loop: true, easing: 'easeInOutQuad' })
      .add({ scale: [1, 1.18], rotate: [0, 14], duration: 500, delay: 2600 })
      .add({ scale: 1, rotate: 0, duration: 600 });

    const cursor = anime.timeline({ targets: pick('cursor'), loop: true, easing: 'easeInOutCubic' })
      .add({ translateX: -26, translateY: 18, duration: 1100, delay: 1800 })
      .add({ scale: [1, 0.88], duration: 120, easing: 'easeOutQuad' })
      .add({ scale: 1, duration: 160, easing: 'easeOutQuad' })
      .add({ translateX: 0, translateY: 0, duration: 1300, delay: 1600 });

    link.style.strokeDashoffset = '0';
    const linkDraw = anime({ targets: link, opacity: [0, 0.75], duration: 900, delay: 400, easing: 'easeOutQuad' });

    stroke.setAttribute('stroke-dasharray', String(stroke.getTotalLength()));
    const drawing = anime.timeline({ loop: true, easing: 'easeInOutSine' })
      .add({ targets: stroke, strokeDashoffset: [stroke.getTotalLength(), 0], opacity: [1, 1], duration: 2400 }, 600)
      .add({ targets: pick('pencil'), translateX: path('x'), translateY: path('y'), duration: 2400 }, 600)
      .add({ targets: stroke, opacity: 0, duration: 500, easing: 'linear' }, 5200)
      .add({ targets: pick('pencil'), opacity: [1, 0], duration: 300, easing: 'linear' }, 5200)
      .add({ targets: pick('pencil'), opacity: 1, translateX: path('x'), translateY: path('y'), duration: 1 }, 5800);

    const running = [note, noteSmall, star, cursor, linkDraw, drawing];
    return () => {
      running.forEach((animation) => animation.pause());
      anime.remove(targets);
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden="true" className="group order-first lg:order-last w-full max-w-md lg:max-w-none lg:flex-1 h-28 sm:h-36 lg:h-auto lg:aspect-[12/11] rounded-xl overflow-hidden border-2 border-outline/20 shadow-xl bg-[#14161c]">
      <svg viewBox="0 0 480 440" preserveAspectRatio="xMidYMid meet" className="block h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="signup-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.4" fill="#ffffff" fillOpacity="0.09" />
          </pattern>
        </defs>
        <rect x="-960" y="-240" width="2400" height="920" fill="url(#signup-dots)" />

        <path data-art="link" d="M 214 150 C 262 128, 288 122, 330 132" stroke="#76f5e8" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 10" opacity="0.75" />

        <g data-art="note" style={hoverBox}>
          <g className={`${hoverGroup} group-hover:-translate-y-1 group-hover:-rotate-2`} style={hoverBox}>
            <rect x="70" y="78" width="146" height="146" rx="14" fill="#fff3a0" />
            <path d="M 92 118 H 190 M 92 146 H 176 M 92 174 H 150" stroke="#1e293b" strokeOpacity="0.55" strokeWidth="6" strokeLinecap="round" />
          </g>
        </g>

        <g data-art="noteSmall" style={hoverBox}>
          <g className={`${hoverGroup} group-hover:translate-x-1 group-hover:rotate-2`} style={hoverBox}>
            <rect x="332" y="92" width="86" height="86" rx="20" fill="#ffb3b0" />
            <circle cx="375" cy="135" r="17" fill="#14161c" fillOpacity="0.8" />
          </g>
        </g>

        <path data-art="star" d="M 100 330 L 108 350 L 130 353 L 114 367 L 118 389 L 100 377 L 82 389 L 86 367 L 70 353 L 92 350 Z" fill="#fff3a0" style={hoverBox} />

        <path data-art="stroke" d={STROKE_PATH} stroke="#76f5e8" strokeWidth="7" strokeLinecap="round" />

        <g data-art="pencil" transform="translate(352 320)">
          <g className={`${hoverGroup} group-hover:-rotate-6`} style={{ transformOrigin: '0 0' }}>
            <path d="M 0 0 L 8 -22 L 56 -70 L 76 -50 L 28 -2 Z" fill="#ffb3b0" />
            <path d="M 0 0 L 8 -22 L 28 -2 Z" fill="#ffffff" />
            <path d="M 56 -70 L 76 -50" stroke="#14161c" strokeWidth="4" />
          </g>
        </g>

        <g data-art="cursor" style={hoverBox}>
          <path d="M 250 196 L 250 244 L 263 232 L 272 252 L 283 247 L 274 227 L 292 226 Z" fill="#ffffff" stroke="#14161c" strokeWidth="3" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
};

export default SignUpIllustration;
