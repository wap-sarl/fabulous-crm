import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../theme/utils';
import { Spinner } from '../feedback/spinner';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-primary-soft focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        fill: '',
        outline: 'border border-input bg-card',
        ghost: '',
        link: 'underline-offset-4 hover:underline cursor-pointer',
      },
      color: {
        default: '',
        secondary: '',
        destructive: '',
        neutral: '',
      },
      size: {
        default: 'h-9.5 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-lg px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    compoundVariants: [
      // fill
      {
        variant: 'fill',
        color: 'default',
        class:
          'bg-linear-135 from-primary to-primary-strong text-primary-foreground shadow-[0_2px_6px_var(--primary-soft)] hover:brightness-105',
      },
      {
        variant: 'fill',
        color: 'secondary',
        class: 'bg-secondary text-secondary-foreground hover:bg-[#E8EAEE]',
      },
      {
        variant: 'fill',
        color: 'destructive',
        class:
          'bg-destructive-soft text-destructive hover:bg-[#F8DCDC] focus-visible:ring-destructive/20',
      },
      {
        variant: 'fill',
        color: 'neutral',
        class: 'bg-muted text-soft hover:bg-[#E8EAEE] hover:text-ink',
      },
      // outline
      {
        variant: 'outline',
        color: 'default',
        class: 'text-body hover:bg-[#F7F8FA]',
      },
      {
        variant: 'outline',
        color: 'secondary',
        class: 'text-soft hover:bg-[#F7F8FA]',
      },
      {
        variant: 'outline',
        color: 'destructive',
        class:
          'text-destructive border-destructive/25 hover:bg-destructive-soft focus-visible:ring-destructive/20',
      },
      {
        variant: 'outline',
        color: 'neutral',
        class: 'text-faint hover:bg-[#F7F8FA] hover:text-body',
      },
      // ghost
      {
        variant: 'ghost',
        color: 'default',
        class: 'text-primary-strong hover:bg-primary-soft/60',
      },
      {
        variant: 'ghost',
        color: 'secondary',
        class: 'text-soft hover:bg-accent hover:text-ink',
      },
      {
        variant: 'ghost',
        color: 'destructive',
        class:
          'text-destructive hover:bg-destructive-soft focus-visible:ring-destructive/20',
      },
      {
        variant: 'ghost',
        color: 'neutral',
        class: 'text-faint hover:bg-accent hover:text-body',
      },
      // link
      { variant: 'link', color: 'default', class: 'text-primary-strong' },
      { variant: 'link', color: 'secondary', class: 'text-soft' },
      { variant: 'link', color: 'destructive', class: 'text-destructive' },
      { variant: 'link', color: 'neutral', class: 'text-muted-foreground' },
    ],
    defaultVariants: {
      variant: 'fill',
      color: 'default',
      size: 'default',
    },
  }
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

function Button({
  className,
  variant = 'fill',
  color = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const content = loading ? (
    <>
      <Spinner size="sm" className="text-current" />
      {children}
    </>
  ) : (
    children
  );

  const commonProps = {
    'data-slot': 'button',
    'data-variant': variant,
    'data-color': color,
    'data-size': size,
    className: cn(buttonVariants({ variant, color, size, className })),
    disabled: disabled || loading,
    ...props,
  };

  return asChild ? (
    <Slot {...commonProps}>{content}</Slot>
  ) : (
    <button {...commonProps}>{content}</button>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
