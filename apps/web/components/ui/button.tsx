import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium leading-none transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 font-sans',
  {
    variants: {
      variant: {
        default:
          'bg-brand-600 text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_1px_2px_rgba(47,71,224,0.3)] hover:bg-brand-700',
        destructive: 'bg-danger text-white hover:opacity-90',
        outline:
          'bg-surface text-ink-800 border border-ink-200 shadow-os-xs hover:bg-ink-50 hover:border-ink-300',
        secondary:
          'bg-surface text-ink-800 border border-ink-200 shadow-os-xs hover:bg-ink-50 hover:border-ink-300',
        ghost: 'bg-transparent text-ink-700 hover:bg-ink-100',
        dark: 'bg-ink-900 text-white hover:bg-ink-800',
        link: 'text-brand-600 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[38px] px-[14px] text-[13.5px] rounded-[10px]',
        sm: 'h-[30px] px-[10px] text-[12.5px] rounded-[8px]',
        lg: 'h-11 px-[18px] text-sm rounded-[12px]',
        icon: 'h-[34px] w-[34px] rounded-[10px] p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
