import React from 'react';
import { useHoverAnimation, createRippleEffect } from '../../animations/useAnime';

export const ActionCard = ({
  icon = 'edit',
  title = 'Action',
  variant = 'primary',
  onClick,
  className = ''
}) => {
  const cardRef = useHoverAnimation({ liftY: -5, scale: 1.03 });

  const handleClick = (e) => {
    createRippleEffect(e, cardRef.current);
    if (onClick) onClick(e);
  };

  const variantStyles = {
    primary: 'bg-primary text-on-primary border-primary hover:bg-primary-container',
    secondary: 'bg-secondary-container text-on-secondary-container border-secondary hover:bg-secondary-fixed-dim',
    tertiary: 'bg-tertiary-container text-on-tertiary-container border-tertiary hover:bg-tertiary-fixed'
  };

  return (
    <button
      ref={cardRef}
      onClick={handleClick}
      className={`group flex flex-col items-center justify-center p-6 rounded-xl border-2 sticker-shadow transition-colors relative overflow-hidden cursor-pointer ${variantStyles[variant] || variantStyles.primary} ${className}`}
    >
      <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
      <span className="material-symbols-outlined text-4xl mb-3 relative z-10">{icon}</span>
      <span className="font-label text-base font-bold relative z-10">{title}</span>
    </button>
  );
};

export default ActionCard;
