import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon, LoaderIcon, XIcon } from 'lucide-react';

import { cn } from '../../theme/utils';
import { Badge } from '../data-display/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../surfaces/popover';
import { Button } from './button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';

export interface MultiSelectItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface MultiSelectProps {
  items: MultiSelectItem[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  popoverWidth?: string;
  modal?: boolean;
}

function MultiSelect({
  items,
  value,
  onValueChange,
  placeholder = 'Sélectionner...',
  searchPlaceholder = 'Rechercher...',
  emptyText = 'Aucun résultat.',
  isLoading = false,
  disabled = false,
  className,
  popoverWidth = 'w-[300px]',
  modal = false,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');

  const selectedItems = items.filter((item) => value.includes(item.value));

  const handleSelect = (selectedValue: string) => {
    const next = value.includes(selectedValue)
      ? value.filter((v) => v !== selectedValue)
      : [...value, selectedValue];
    onValueChange(next);
    // Intentionally no setOpen(false) — popover stays open for multi-selection
  };

  const handleRemove = (e: React.MouseEvent, removedValue: string) => {
    e.stopPropagation();
    onValueChange(value.filter((v) => v !== removedValue));
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between h-auto min-h-9', popoverWidth, className)}
        >
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {selectedItems.length > 0 ? (
              selectedItems.map((item) => (
                <Badge key={item.value} variant="secondary" className="text-xs">
                  {item.label}
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-1 rounded-full outline-none hover:bg-muted-foreground/20 cursor-pointer"
                    onClick={(e) => handleRemove(e, item.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onValueChange(value.filter((v) => v !== item.value));
                      }
                    }}
                  >
                    <XIcon className="h-3 w-3" />
                  </span>
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground font-normal">{placeholder}</span>
            )}
          </div>
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-0', popoverWidth !== 'w-full' && popoverWidth)}
        style={
          popoverWidth === 'w-full' ? { width: 'var(--radix-popover-trigger-width)' } : undefined
        }
        onFocusOutside={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={searchValue}
            onValueChange={setSearchValue}
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
                  {items
                    .filter((item) => item.label.toLowerCase().includes(searchValue.toLowerCase()))
                    .map((item) => (
                      <CommandItem
                        key={item.value}
                        value={item.value}
                        keywords={[item.label]}
                        disabled={item.disabled}
                        onMouseDown={(e) => e.preventDefault()}
                        onSelect={handleSelect}
                      >
                        <CheckIcon
                          className={cn(
                            'mr-2 h-4 w-4',
                            value.includes(item.value) ? 'opacity-100' : 'opacity-0',
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

export { MultiSelect };
