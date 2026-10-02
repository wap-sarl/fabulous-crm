import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { LoaderIcon } from 'lucide-react';

import { cn } from '../../theme/utils';
import { Collapse } from '../surfaces/collapse';
import { Popover, PopoverAnchor, PopoverContent } from '../surfaces/popover';
import type {
  AddressDetailsResolver,
  AddressSuggestion,
  AddressSuggestionsProvider,
  AddressValue,
} from './address-providers';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './command';
import { Input } from './input';
import { Label } from './label';
import { Switch } from './switch';

type AddressFieldKey = 'streetNumber' | 'street' | 'postalCode' | 'city' | 'country';

const DEFAULT_LABELS: Record<AddressFieldKey, string> = {
  street: 'Rue',
  streetNumber: 'Numéro',
  postalCode: 'Code postal',
  city: 'Ville',
  country: 'Pays',
};

const DEFAULT_PLACEHOLDERS: Record<AddressFieldKey, string> = {
  street: 'Commencez à saisir votre adresse…',
  streetNumber: 'N°',
  postalCode: '75001',
  city: 'Paris',
  country: 'FR',
};

/** Shared base classes — kept in sync with `input.tsx`. */
const INPUT_BASE =
  'flex h-9.5 w-full rounded-lg border border-input bg-card px-3 py-2 text-base placeholder:text-placeholder focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

interface AddressInputProps {
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  /** Suggestions provider. Omit to render the street as a plain (manual-only) field. */
  fetchSuggestions?: AddressSuggestionsProvider;
  /** Resolves a selected suggestion to structured fields. Required for autofill. */
  resolveDetails?: AddressDetailsResolver;
  /** Show the country field. Defaults to true. */
  showCountry?: boolean;
  disabled?: boolean;
  /** Mark the whole block, or specific fields, invalid. */
  invalid?: boolean | Partial<Record<AddressFieldKey, boolean>>;
  labels?: Partial<Record<AddressFieldKey, string>>;
  placeholders?: Partial<Record<AddressFieldKey, string>>;
  /** Minimum characters before a fetch is triggered. Defaults to 3. */
  minQueryLength?: number;
  /** Debounce delay in ms. Defaults to 250. */
  debounceMs?: number;
  /** Prefix for field ids, e.g. "wz" → `wz-addressStreet`. */
  idPrefix?: string;
  /** Label for the collapsed full-address search input. Defaults to 'Adresse'. */
  searchLabel?: string;
  /** Append ` *` to the search label to mark the address as required. Defaults to false. */
  required?: boolean;
  /** Placeholder for the collapsed full-address search input. Defaults to the street placeholder. */
  searchPlaceholder?: string;
  className?: string;
  renderFields?: (props: {
    value: AddressValue;
    onChange: (value: AddressValue) => void;
    disabled?: boolean;
  }) => React.ReactNode;
  /** One-line rendering of a picked address in the collapsed search box. */
  formatOneLine?: (value: AddressValue) => string;
}

/** Keep an existing value when the incoming patch has nothing for that field. */
function mergeAddress(prev: AddressValue, patch: Partial<AddressValue>): AddressValue {
  return {
    streetNumber: patch.streetNumber || prev.streetNumber,
    street: patch.street || prev.street,
    line2: patch.line2 ?? prev.line2,
    postalCode: patch.postalCode || prev.postalCode,
    city: patch.city || prev.city,
    region: patch.region ?? prev.region,
    country: patch.country || prev.country,
    placeId: patch.placeId ?? prev.placeId,
    coordinates: patch.coordinates ?? prev.coordinates,
  };
}

/** One-line address for the collapsed (autocomplete) input, e.g. "8 Rue X, 75002 Paris, France". */
function formatAddressOneLine(v: AddressValue): string {
  const line1 = [v.streetNumber, v.street].filter(Boolean).join(' ');
  const line2 = [v.postalCode, v.city].filter(Boolean).join(' ');
  return [line1, line2, v.country].filter(Boolean).join(', ');
}

function AddressInput({
  value,
  onChange,
  fetchSuggestions,
  resolveDetails,
  showCountry = true,
  disabled,
  invalid,
  labels,
  placeholders,
  minQueryLength = 3,
  debounceMs = 250,
  idPrefix,
  searchLabel = 'Adresse',
  required = false,
  searchPlaceholder = DEFAULT_PLACEHOLDERS.street,
  className,
  renderFields,
  formatOneLine = formatAddressOneLine,
}: AddressInputProps) {
  const hasAutocomplete = !!fetchSuggestions;
  const [open, setOpen] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<AddressSuggestion[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isResolving, setIsResolving] = React.useState(false);
  // Collapsed by default: only the autocomplete input shows until the switch reveals the manual fields.
  const [manualEntry, setManualEntry] = React.useState(false);
  // `query` is the search text, never persisted into `value.street`; `editing` tells typing a query from showing the picked address.
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const justSelectedRef = React.useRef(false);

  const showFields = !hasAutocomplete || manualEntry;
  const hasAddress = !!(value.street && (value.city || value.postalCode));
  const displayValue = editing ? query : hasAddress ? formatOneLine(value) : query;
  const searchId = `${idPrefix ? `${idPrefix}-` : ''}addressSearch`;
  const manualToggleId = `${idPrefix ? `${idPrefix}-` : ''}addressManualToggle`;

  React.useEffect(() => {
    if (!fetchSuggestions) return;
    if (justSelectedRef.current) {
      // A selection just seeded `query` with the one-line address; don't re-search it.
      justSelectedRef.current = false;
      setSuggestions([]);
      setIsLoading(false);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < minQueryLength) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    const timer = setTimeout(() => {
      fetchSuggestions(trimmed, controller.signal)
        .then((results) => setSuggestions(results))
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name !== 'AbortError') setSuggestions([]);
        })
        .finally(() => setIsLoading(false));
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, fetchSuggestions, minQueryLength, debounceMs]);

  const fieldId = (key: AddressFieldKey) =>
    `${idPrefix ? `${idPrefix}-` : ''}address${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const labelFor = (key: AddressFieldKey) => labels?.[key] ?? DEFAULT_LABELS[key];
  const placeholderFor = (key: AddressFieldKey) => placeholders?.[key] ?? DEFAULT_PLACEHOLDERS[key];
  const isInvalid = (key: AddressFieldKey) =>
    typeof invalid === 'boolean' ? invalid : !!invalid?.[key];

  // Detail fields left invalid by the autocomplete, as with free text, reveal the manual fields so the user can fix them.
  const detailInvalid =
    isInvalid('streetNumber') ||
    isInvalid('street') ||
    isInvalid('postalCode') ||
    isInvalid('city') ||
    isInvalid('country');
  React.useEffect(() => {
    if (hasAutocomplete && !manualEntry && detailInvalid) setManualEntry(true);
  }, [hasAutocomplete, manualEntry, detailInvalid]);

  const updateField = (key: AddressFieldKey, next: string) => {
    onChange({ ...value, [key]: next, placeId: undefined });
  };

  const handleSelect = async (suggestion: AddressSuggestion) => {
    justSelectedRef.current = true;
    setEditing(false);
    setOpen(false);
    setSuggestions([]);
    if (!resolveDetails) {
      const next = { ...value, street: suggestion.label, placeId: suggestion.placeId };
      setQuery(formatOneLine(next));
      onChange(next);
      return;
    }
    setIsResolving(true);
    const controller = new AbortController();
    try {
      const details = await resolveDetails(suggestion, controller.signal);
      const next = mergeAddress(value, details);
      setQuery(formatOneLine(next));
      onChange(next);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        const next = { ...value, street: suggestion.label, placeId: suggestion.placeId };
        setQuery(formatOneLine(next));
        onChange(next);
      }
    } finally {
      setIsResolving(false);
    }
  };

  const trimmedLength = query.trim().length;
  const showNoResults =
    !isLoading && !isResolving && suggestions.length === 0 && trimmedLength >= minQueryLength;

  const renderField = (key: AddressFieldKey, fieldClassName?: string) => (
    <div className={cn('grid gap-1.5', fieldClassName)}>
      <Label htmlFor={fieldId(key)} required={required}>
        {labelFor(key)}
      </Label>
      <Input
        id={fieldId(key)}
        value={value[key] ?? ''}
        onChange={(e) => updateField(key, e.target.value)}
        placeholder={placeholderFor(key)}
        disabled={disabled}
        invalid={isInvalid(key)}
        autoComplete="off"
        aria-required={required}
      />
    </div>
  );

  return (
    <div className={cn('grid', className)}>
      {hasAutocomplete && (
        <div className="grid gap-1.5">
          <Label htmlFor={searchId} required={required}>
            {searchLabel}
          </Label>
          <div ref={wrapperRef} className="relative">
            <Popover open={open} onOpenChange={setOpen}>
              <Command shouldFilter={false} className="overflow-visible bg-transparent">
                <PopoverAnchor asChild>
                  <div className="relative">
                    <CommandPrimitive.Input
                      id={searchId}
                      value={displayValue}
                      onValueChange={(next) => {
                        setEditing(true);
                        setQuery(next);
                        setOpen(next.trim().length >= minQueryLength);
                      }}
                      onFocus={() => {
                        setEditing(true);
                        if (hasAddress && query === '') setQuery(formatOneLine(value));
                        if (trimmedLength >= minQueryLength && suggestions.length > 0) {
                          setOpen(true);
                        }
                      }}
                      onBlur={() => setEditing(false)}
                      placeholder={searchPlaceholder}
                      // In manual entry the split fields below take over, so the search is disabled.
                      disabled={disabled || manualEntry}
                      // Chrome ignores `autocomplete="off"` on address fields and would cover the suggestions; `new-password` suppresses it, the data-* attributes opt out of 1Password and LastPass.
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      className={INPUT_BASE}
                    />
                    {(isLoading || isResolving) && (
                      <LoaderIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </PopoverAnchor>
                <PopoverContent
                  align="start"
                  sideOffset={4}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onInteractOutside={(e) => {
                    const target = e.target as Node | null;
                    if (target && wrapperRef.current?.contains(target)) e.preventDefault();
                  }}
                  className="w-(--radix-popover-trigger-width) p-0"
                >
                  <CommandList>
                    {isLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : showNoResults ? (
                      <CommandEmpty>Aucune adresse trouvée.</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {suggestions.map((s) => (
                          <CommandItem key={s.id} value={s.id} onSelect={() => handleSelect(s)}>
                            <span className="flex flex-col">
                              <span>{s.label}</span>
                              {s.description && s.description !== s.label && (
                                <span className="text-xs text-muted-foreground">
                                  {s.description}
                                </span>
                              )}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </PopoverContent>
              </Command>
            </Popover>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={manualToggleId}
              aria-label="Je ne trouve pas mon adresse"
              checked={manualEntry}
              onCheckedChange={(checked) => {
                setManualEntry(checked);
                if (checked) setOpen(false);
              }}
              disabled={disabled}
              size="sm"
            />
            <Label
              htmlFor={manualToggleId}
              className="cursor-pointer text-sm font-normal text-muted-foreground"
            >
              Je ne trouve pas mon adresse
            </Label>
          </div>
        </div>
      )}

      <Collapse open={showFields}>
        <div className={cn('grid gap-3 p-1', hasAutocomplete && 'pt-3')}>
          {renderFields ? (
            renderFields({ value, onChange, disabled })
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                {renderField('streetNumber', 'sm:col-span-1')}
                {renderField('street', 'sm:col-span-3')}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {renderField('postalCode')}
                {renderField('city')}
              </div>

              {showCountry && renderField('country')}
            </>
          )}
        </div>
      </Collapse>
    </div>
  );
}

export { AddressInput };
