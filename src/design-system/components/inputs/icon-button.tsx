import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../theme/utils';
import { Button, type ButtonProps } from './button';

const iconButtonVariants = cva('rounded-lg text-faint hover:text-body', {
  variants: {
    variant: {
      default: 'hover:bg-[#EEF0F3]',
      primary: 'text-primary-strong hover:bg-primary-soft hover:text-primary-strong',
      secondary: 'text-soft hover:bg-accent hover:text-ink',
      destructive: 'text-destructive hover:bg-destructive-soft hover:text-destructive',
    },
    size: { xs: '', sm: '', default: '', lg: '' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

const sizeMap = {
  xs: 'icon-xs',
  sm: 'icon-sm',
  default: 'icon',
  lg: 'icon-lg',
} as const satisfies Record<
  NonNullable<VariantProps<typeof iconButtonVariants>['size']>,
  NonNullable<ButtonProps['size']>
>;

type IconButtonProps = Omit<ButtonProps, 'variant' | 'color' | 'size' | 'aria-label'> &
  VariantProps<typeof iconButtonVariants> & {
    'aria-label': string;
  };

function IconButton({
  className,
  variant = 'default',
  size = 'default',
  children,
  ...props
}: IconButtonProps) {
  return (
    <Button
      variant="ghost"
      size={sizeMap[size ?? 'default']}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export { IconButton, iconButtonVariants };
export type { IconButtonProps };
