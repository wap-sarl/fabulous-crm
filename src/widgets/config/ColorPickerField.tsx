import { useEffect, useId, useState } from 'react';
import { Input, Label, cn } from '@crm/design-system';
import { Check } from 'lucide-react';

/** Theme default (`--primary` in theme.css) — the fallback when nothing is set. */
export const DEFAULT_PRIMARY_COLOR = '#5b50f5';

/** Curated brand accents shown as one-click presets (includes the default). */
const PRESETS = [
  DEFAULT_PRIMARY_COLOR, // Indigo (default)
  '#2e7bff', // Blue
  '#0e8a8a', // Teal
  '#12a150', // Green
  '#b4740a', // Amber
  '#d23b3f', // Red
  '#c026d3', // Fuchsia
  '#111827', // Ink
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const normalize = (hex: string) => hex.trim().toLowerCase();

export interface ColorPickerFieldProps {
  label: string;
  /** Human hint under the field. */
  hint?: string;
  /** Current `#rrggbb` value; null/undefined falls back to the theme default. */
  value?: string | null;
  /** Called with a valid, lowercased `#rrggbb` whenever the color changes. */
  onChange: (hex: string) => void;
}

/**
 * Brand accent color picker: a row of preset swatches plus a native color well
 * and a hex text field for custom values. Mirrors `ImageUploadField`'s shape
 * (label/hint + onChange callback) so the setup wizard and settings screen can
 * share it. Only emits valid `#rrggbb` values; partial hex typing is tolerated
 * locally without firing `onChange`.
 */
export function ColorPickerField({ label, hint, value, onChange }: ColorPickerFieldProps) {
  const inputId = useId();
  const current = value && HEX_RE.test(value) ? normalize(value) : DEFAULT_PRIMARY_COLOR;
  // Local text buffer so the user can type an incomplete hex without it being
  // rejected mid-entry; kept in sync when the committed value changes elsewhere.
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);

  const commit = (raw: string) => {
    const hex = normalize(raw);
    if (HEX_RE.test(hex)) onChange(hex);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => {
          const selected = normalize(preset) === current;
          return (
            <button
              key={preset}
              type="button"
              aria-label={preset}
              aria-pressed={selected}
              onClick={() => onChange(normalize(preset))}
              style={{ backgroundColor: preset }}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg border border-border transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft',
                selected && 'ring-2 ring-primary ring-offset-2 ring-offset-card'
              )}
            >
              {selected && <Check className="size-4 text-white" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        {/* Native color well for arbitrary custom colors. */}
        <input
          id={inputId}
          type="color"
          value={current}
          onChange={(e) => onChange(normalize(e.target.value))}
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-input bg-card p-0.5"
          aria-label="Couleur personnalisée"
        />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          }}
          spellCheck={false}
          className="w-32 font-mono"
          placeholder="#5b50f5"
        />
      </div>
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}
