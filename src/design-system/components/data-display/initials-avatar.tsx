import { cn } from '../../theme/utils';

/** The 8 bg/fg pairs from the design, cycled deterministically by name. */
const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: '#EEEDFE', fg: '#4B41E0' },
  { bg: '#E7F0FF', fg: '#1D6BE0' },
  { bg: '#E3F6EC', fg: '#0C8A43' },
  { bg: '#FCF1DD', fg: '#B4740A' },
  { bg: '#FBE9E9', fg: '#D23B3F' },
  { bg: '#E6F6F6', fg: '#0E8A8A' },
  { bg: '#F0EBFE', fg: '#6A4BF0' },
  { bg: '#FCE8F1', fg: '#D6408A' },
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface InitialsAvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  /** Diameter in px. @default 36 */
  size?: number;
}

/**
 * Circular initials avatar tinted from an 8-color palette, stable per name.
 */
function InitialsAvatar({ name, size = 36, className, style, ...props }: InitialsAvatarProps) {
  const { bg, fg } = AVATAR_PALETTE[hashName(name) % AVATAR_PALETTE.length];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        backgroundColor: bg,
        color: fg,
        ...style,
      }}
      {...props}
    >
      {initialsOf(name)}
    </span>
  );
}

export { InitialsAvatar, AVATAR_PALETTE };
export type { InitialsAvatarProps };
