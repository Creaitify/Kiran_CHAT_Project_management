/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

const buttonVariantClasses = {
  primary:
    "bg-accent-primary text-on-color hover:bg-accent-primary-hover active:bg-accent-primary-active disabled:bg-layer-disabled disabled:text-on-color-disabled",
  "error-fill":
    "bg-danger-primary text-on-color hover:bg-danger-primary-hover active:bg-danger-primary-active disabled:bg-layer-disabled disabled:text-disabled",
  "error-outline":
    "border border-danger-strong bg-layer-2 text-danger-secondary hover:bg-danger-subtle active:bg-danger-subtle-hover disabled:border-subtle-1 disabled:bg-layer-2 disabled:text-disabled",
  secondary:
    "border border-strong bg-layer-2 text-secondary shadow-raised-100 hover:bg-layer-2-hover active:bg-layer-2-active disabled:border-subtle-1 disabled:bg-layer-transparent disabled:text-disabled",
  tertiary:
    "bg-layer-3 text-secondary hover:bg-layer-3-hover active:bg-layer-3-active disabled:bg-layer-transparent disabled:text-disabled",
  ghost:
    "bg-layer-transparent text-secondary hover:bg-layer-transparent-hover focus:bg-layer-transparent-active active:bg-layer-transparent-active disabled:bg-layer-transparent disabled:text-disabled",
  // `link` owns its horizontal padding outright: it is zero at every size, so it belongs on
  // the variant rather than on a (variant, size) pair. See the note on PADDED_VARIANTS.
  link: "px-0 text-link-primary underline hover:text-link-primary-hover focus:text-link-primary-hover active:text-link-primary-hover disabled:text-disabled",
};

/**
 * Every variant except `link` wants the horizontal padding that belongs to its size.
 *
 * Horizontal padding deliberately does NOT live on the `size` slots below. cva concatenates
 * base -> variant -> size -> compoundVariants with plain `clsx`, so a `px-0` on the `link`
 * variant and a `px-2` on the size slot both survived into the emitted string, size last.
 * `cn()` (tailwind-merge) then keeps the LAST of two conflicting utilities and dropped
 * `link`'s `px-0`, which is why `variant="link"` used to render with dead space either side
 * of its label. Routing padding through `compoundVariants` emits exactly one horizontal
 * padding utility per (variant, size) pair, so the class string is unambiguous on its own
 * and nothing depends on tailwind-merge resolving a conflict the right way -- that reliance
 * is what broke here in the first place. An `!px-0` override would also "work", but it hides
 * the conflict instead of removing it and makes the next one harder to reason about.
 */
const PADDED_VARIANTS: Exclude<keyof typeof buttonVariantClasses, "link">[] = [
  "primary",
  "error-fill",
  "error-outline",
  "secondary",
  "tertiary",
  "ghost",
];

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors focus-visible:outline-none disabled:pointer-events-none",
  {
    variants: {
      variant: buttonVariantClasses,
      size: {
        sm: "h-5 rounded-sm text-caption-md-medium",
        base: "h-6 rounded-md text-body-xs-medium",
        lg: "h-7 rounded-md text-body-xs-medium",
        xl: "h-8 rounded-md text-body-sm-medium",
      },
    },
    compoundVariants: [
      { variant: PADDED_VARIANTS, size: "sm", class: "px-1.5" },
      { variant: PADDED_VARIANTS, size: ["base", "lg", "xl"], class: "px-2" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "base",
    },
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    appendIcon?: React.ReactElement;
    loading?: boolean;
    prependIcon?: React.ReactElement;
  };

export type TButtonVariant = NonNullable<ButtonProps["variant"]>;
export type TButtonSize = NonNullable<ButtonProps["size"]>;

const buttonIconStyling: Record<TButtonSize, string> = {
  sm: "size-3.5",
  base: "size-3.5",
  lg: "size-4",
  xl: "size-4 ",
};

export function getIconStyling(size: TButtonSize): string {
  return buttonIconStyling[size];
}

export function getButtonStyling(variant: TButtonVariant, size: TButtonSize): string {
  return buttonVariants({ variant, size });
}
