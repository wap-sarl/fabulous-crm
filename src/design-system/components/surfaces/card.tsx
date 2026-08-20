import * as React from 'react';
import { cn } from '../../theme/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  clickable?: boolean;
}

function Card({
  className,
  clickable,
  ref,
  ...props
}: CardProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-card',
        clickable && 'cursor-pointer transition-all hover:border-[#DADDE4] hover:shadow-card-hover',
        className
      )}
      {...props}
    />
  );
}

function CardHeader({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />;
}

function CardTitle({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cn('font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function CardContent({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
}

function CardFooter({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
