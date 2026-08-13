import React, { useRef } from 'react';
import { useHoverAnimation, createRippleEffect } from '../../animations/useAnime';

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  icon,
  className = '',
  ...props
}) => {
  const buttonRef = useHoverAnimation();

  const handleClick = (e) => {
    createRippleEffect(e, buttonRef.current);
    if (onClick) onClick(e);
  };

  const variants = {
    primary: 'bg-primary text-on-primary border-2 border-primary sticker-shadow hover:bg-primary-container',
    secondary: 'bg-secondary-container text-on-secondary-container border-2 border-secondary sticker-shadow',
    outline: 'bg-transparent text-primary border-2 border-primary',
    ghost: 'bg-transparent text-on-surface hover:bg-surface-container-high'
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm rounded-lg',
    md: 'px-5 py-2.5 text-base rounded-full',
    lg: 'px-8 py-4 text-lg rounded-full font-bold'
  };

  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      className={`inline-flex items-center justify-center gap-2 font-label font-semibold transition-colors cursor-pointer relative overflow-hidden ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon && <span className="material-symbols-outlined">{icon}</span>}
      <span className="relative z-10">{children}</span>
    </button>
  );
};

export default Button;
