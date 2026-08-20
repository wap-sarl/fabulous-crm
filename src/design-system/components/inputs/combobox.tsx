import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon, LoaderIcon } from 'lucide-react';

import { cn } from '../../theme/utils';
import { Button } from './button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';
import { Popover, PopoverContent, PopoverTrigger } from '../surfaces/popover';

export interface ComboboxItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  /** Items to display in the dropdown */
  items: ComboboxItem[];
  /** Currently selected value */
  value?: string;
  /** Callback when selection changes */
  onValueChange?: (value: string) => void;
  /** Callback when search input changes */
  onSearch?: (search: string) => void;
  /** Placeholder text for the trigger button */
  placeholder?: string;
  /** Placeholder text for the search input */
  searchPlaceholder?: string;
  /** Text to display when no items match the search */
  emptyText?: string;
  /** Whether the combobox is in a loading state */
  isLoading?: boolean;
  /** Whether the combobox is disabled */
  disabled?: boolean;
  /** Additional class name for the trigger button */
  className?: string;
  /** Width of the popover content */
  popoverWidth?: string;
  /** Set to true when used inside a Dialog to fix scroll issues */
  modal?: boolean;
}

function Combobox({
  items,
  value,
  onValueChange,
  onSearch,
  placeholder = 'Sélectionner...',
  searchPlaceholder = 'Rechercher...',
  emptyText = 'Aucun résultat.',
  isLoading = false,
  disabled = false,
  className,
  popoverWidth = 'w-[300px]',
  modal = false,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');

  const selectedItem = items.find((item) => item.value === value);

  const handleSearchChange = (search: string) => {
    setSearchValue(search);
    onSearch?.(search);
  };

  const handleSelect = (currentValue: string) => {
    const newValue = currentValue === value ? '' : currentValue;
    onValueChange?.(newValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between', popoverWidth, className)}
        >
          <span className="truncate">{selectedItem ? selectedItem.label : placeholder}</span>
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0', popoverWidth !== 'w-full' && popoverWidth)}
        style={
          popoverWidth === 'w-full' ? { width: 'var(--radix-popover-trigger-width)' } : undefined
        }
      >
        <Command shouldFilter={!onSearch}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={searchValue}
            onValueChange={handleSearchChange}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {items.map((item) => (
                    <CommandItem
                      key={item.value}
                      value={item.value}
                      keywords={[item.label]}
                      disabled={item.disabled}
                      onSelect={handleSelect}
                    >
                      <CheckIcon
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === item.value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { Combobox };
