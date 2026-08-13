import React from 'react';

export const SkeletonLoader = ({ className = '', type = 'card' }) => {
  if (type === 'avatar') {
    return <div className={`w-10 h-10 rounded-full bg-surface-container-high animate-pulse ${className}`} />;
  }

  if (type === 'text') {
    return <div className={`h-4 bg-surface-container-high rounded-full animate-pulse ${className}`} />;
  }

  return (
    <div className={`bg-surface-container-lowest border-2 border-outline-variant/40 rounded-xl p-4 shadow-sm animate-pulse ${className}`}>
      <div className="w-full h-32 bg-surface-container-high rounded-lg mb-3" />
      <div className="h-4 bg-surface-container-high rounded-full w-3/4 mb-2" />
      <div className="h-3 bg-surface-container-high rounded-full w-1/2" />
    </div>
  );
};

export default SkeletonLoader;
