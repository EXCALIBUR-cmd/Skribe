import React from 'react';

export const StickerBadge = ({
  icon = 'star',
  bgColor = 'bg-tertiary-fixed',
  textColor = 'text-on-tertiary-fixed',
  rotate = 'rotate-12',
  className = ''
}) => {
  return (
    <div
      className={`w-12 h-12 ${bgColor} rounded-full flex items-center justify-center animate-wiggle sticker-shadow border-2 border-outline-variant ${rotate} ${className}`}
    >
      <span className={`material-symbols-outlined ${textColor}`}>{icon}</span>
    </div>
  );
};

export default StickerBadge;
