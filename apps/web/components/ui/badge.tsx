import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 h-[22px] rounded-full px-2 text-[11.5px] font-medium leading-none border border-transparent transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-ink-100 text-ink-700',
        secondary: 'bg-ink-100 text-ink-700',
        brand: 'bg-brand-50 text-brand-700',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
        destructive: 'bg-danger-bg text-danger',
        neutral: 'bg-ink-100 text-ink-700',
        outline: 'bg-transparent border-ink-200 text-ink-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
