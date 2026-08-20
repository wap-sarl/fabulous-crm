/* eslint-disable jsx-a11y/no-autofocus -- DayPicker uses autoFocus to preserve popover keyboard focus. */
import * as React from 'react';
import { format, parse, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Calendar } from './calendar';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../surfaces/popover';
import { Input } from './input';
import { cn } from '../../theme/utils';

export interface DatePickerProps {
  /** Date value as yyyy-MM-dd string */
  value?: string;
  /** Callback when date changes, receives yyyy-MM-dd string */
  onValueChange?: (value: string) => void;
  /** Placeholder text when no date is selected */
  placeholder?: string;
  /** Whether the input is in an invalid state */
  invalid?: boolean;
  /** HTML id attribute */
  id?: string;
  /** Additional class names */
  className?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Default month to display when opening the calendar with no value */
  defaultMonth?: Date;
  /** Days to disable in the calendar (react-day-picker matcher) */
  disabledDays?: React.ComponentProps<typeof Calendar>['disabled'];
}

function DatePicker({
  value,
  onValueChange,
  placeholder = 'JJ/MM/AAAA',
  invalid,
  id,
  className,
  disabled,
  defaultMonth,
  disabledDays,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    return parse(value, 'yyyy-MM-dd', new Date());
  }, [value]);

  // Text input mirrors the value in DD/MM/YYYY format
  const [inputValue, setInputValue] = React.useState(() =>
    selectedDate ? format(selectedDate, 'dd/MM/yyyy') : ''
  );

  // Sync input when value changes externally (e.g. calendar pick)
  React.useEffect(() => {
    setInputValue(selectedDate ? format(selectedDate, 'dd/MM/yyyy') : '');
  }, [selectedDate]);

  const handleSelect = React.useCallback(
    (date: Date | undefined) => {
      if (date) {
        onValueChange?.(format(date, 'yyyy-MM-dd'));
      }
      setOpen(false);
    },
    [onValueChange]
  );

  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setInputValue(raw);

      // Try to parse a complete DD/MM/YYYY input
      if (raw.length === 10) {
        const parsed = parse(raw, 'dd/MM/yyyy', new Date());
        if (isValid(parsed)) {
          onValueChange?.(format(parsed, 'yyyy-MM-dd'));
        }
      }
    },
    [onValueChange]
  );

  const handleInputBlur = React.useCallback(() => {
    // On blur, try to parse whatever is in the input
    if (inputValue) {
      const parsed = parse(inputValue, 'dd/MM/yyyy', new Date());
      if (isValid(parsed) && parsed.getFullYear() > 1900) {
        onValueChange?.(format(parsed, 'yyyy-MM-dd'));
      } else {
        // Reset to the current value if invalid
        setInputValue(selectedDate ? format(selectedDate, 'dd/MM/yyyy') : '');
      }
    } else {
      // Cleared the input — clear the value
      onValueChange?.('');
    }
  }, [inputValue, selectedDate, onValueChange]);

  const calendarDefaultMonth = selectedDate ?? defaultMonth;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            id={id}
            type="text"
            inputMode="numeric"
            placeholder={placeholder}
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            disabled={disabled}
            invalid={invalid}
            className={cn('pr-10', className)}
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Ouvrir le calendrier"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          disabled={disabledDays}
          defaultMonth={calendarDefaultMonth}
          locale={fr}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
