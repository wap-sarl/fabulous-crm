/**
 * Decorative floating squares background.
 * Shared across error pages (404, 500, etc.).
 */
export function DecorativeSquares() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Top left cluster */}
      <div className="absolute top-8 left-8 w-6 h-6 bg-primary/20 rounded-sm" />
      <div className="absolute top-8 left-20 w-4 h-4 bg-primary/30 rounded-sm" />
      <div className="absolute top-20 left-12 w-8 h-8 bg-primary/15 rounded-sm" />
      <div className="absolute top-16 left-32 w-3 h-3 bg-primary/25 rounded-sm" />

      {/* Top right cluster */}
      <div className="absolute top-12 right-16 w-5 h-5 bg-primary/20 rounded-sm" />
      <div className="absolute top-6 right-32 w-7 h-7 bg-primary/15 rounded-sm" />
      <div className="absolute top-24 right-24 w-4 h-4 bg-primary/30 rounded-sm" />

      {/* Bottom left cluster */}
      <div className="absolute bottom-16 left-16 w-6 h-6 bg-primary/25 rounded-sm" />
      <div className="absolute bottom-8 left-8 w-4 h-4 bg-primary/20 rounded-sm" />
      <div className="absolute bottom-24 left-28 w-5 h-5 bg-primary/15 rounded-sm" />

      {/* Bottom right cluster */}
      <div className="absolute bottom-12 right-12 w-8 h-8 bg-primary/20 rounded-sm" />
      <div className="absolute bottom-20 right-28 w-4 h-4 bg-primary/30 rounded-sm" />
      <div className="absolute bottom-32 right-8 w-6 h-6 bg-primary/15 rounded-sm" />

      {/* Center scattered */}
      <div className="absolute top-1/3 left-1/4 w-3 h-3 bg-primary/20 rounded-sm" />
      <div className="absolute top-2/3 right-1/4 w-4 h-4 bg-primary/15 rounded-sm" />
    </div>
  );
}

/**
 * Large decorative error code number with gradient effect.
 */
export function LargeErrorCode({ code }: { code: string }) {
  return (
    <div className="relative select-none">
      <span className="text-[12rem] md:text-[16rem] font-display font-bold leading-none tracking-tighter text-primary/10">
        {code}
      </span>
      <span className="absolute inset-0 text-[12rem] md:text-[16rem] font-display font-bold leading-none tracking-tighter bg-gradient-to-b from-primary to-primary/50 bg-clip-text text-transparent">
        {code}
      </span>
    </div>
  );
}
