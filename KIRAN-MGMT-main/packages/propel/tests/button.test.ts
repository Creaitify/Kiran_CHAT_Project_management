/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { getButtonStyling } from "../src/button/helper";
import type { TButtonSize, TButtonVariant } from "../src/button/helper";
import { cn } from "../src/utils";

/**
 * Regression guard for the reported defect "primary Button renders with disabled colours
 * while genuinely enabled".
 *
 * The CSS itself is correct — the original report was a measurement artifact (a hidden
 * document freezes `document.timeline`, so the 150ms `transition-colors` fade never
 * advanced past its first frame). What *can* silently regress is the class string the
 * Button emits: `bg-accent-primary` and `disabled:bg-layer-disabled` land in the same
 * tailwind-merge class group and are only kept apart by their differing modifier sets.
 * If the `extendTailwindMerge` config in `src/utils/classname.tsx` ever collapses them,
 * `cn()` drops one half of the pair and every button looks permanently disabled — with
 * no error raised anywhere. These tests lock the pairs together.
 */

type TColorPair = {
  /** Enabled-state background utility, or `null` for variants that paint no background. */
  background: string | null;
  /** Disabled-state background utility, or `null` for variants that paint no background. */
  disabledBackground: string | null;
  /** Enabled-state text colour utility. */
  text: string;
  /** Disabled-state text colour utility. */
  disabledText: string;
};

/**
 * Transcribed from the `cva` config in `src/button/helper.tsx`. The `Record` key type makes
 * this exhaustive: adding a variant to the component without adding it here is a type error.
 */
const VARIANT_COLOR_PAIRS: Record<TButtonVariant, TColorPair> = {
  primary: {
    background: "bg-accent-primary",
    disabledBackground: "disabled:bg-layer-disabled",
    text: "text-on-color",
    disabledText: "disabled:text-on-color-disabled",
  },
  secondary: {
    background: "bg-layer-2",
    disabledBackground: "disabled:bg-layer-transparent",
    text: "text-secondary",
    disabledText: "disabled:text-disabled",
  },
  tertiary: {
    background: "bg-layer-3",
    disabledBackground: "disabled:bg-layer-transparent",
    text: "text-secondary",
    disabledText: "disabled:text-disabled",
  },
  ghost: {
    background: "bg-layer-transparent",
    disabledBackground: "disabled:bg-layer-transparent",
    text: "text-secondary",
    disabledText: "disabled:text-disabled",
  },
  // The link variant is text-only — it declares no background utility in either state.
  link: {
    background: null,
    disabledBackground: null,
    text: "text-link-primary",
    disabledText: "disabled:text-disabled",
  },
  "error-fill": {
    background: "bg-danger-primary",
    disabledBackground: "disabled:bg-layer-disabled",
    text: "text-on-color",
    disabledText: "disabled:text-disabled",
  },
  "error-outline": {
    background: "bg-layer-2",
    disabledBackground: "disabled:bg-layer-2",
    text: "text-danger-secondary",
    disabledText: "disabled:text-disabled",
  },
};

const VARIANTS = Object.keys(VARIANT_COLOR_PAIRS) as TButtonVariant[];

/**
 * Horizontal padding each `size` slot is expected to hand to a padded variant, transcribed
 * from the `compoundVariants` block in `src/button/helper.tsx`. The `Record` key type keeps
 * this exhaustive the same way `VARIANT_COLOR_PAIRS` does.
 */
const SIZE_HORIZONTAL_PADDING: Record<TButtonSize, string> = {
  sm: "px-1.5",
  base: "px-2",
  lg: "px-2",
  xl: "px-2",
};

/** Row height each `size` slot reserves — see the height note above the padding tests. */
const SIZE_HEIGHT: Record<TButtonSize, string> = {
  sm: "h-5",
  base: "h-6",
  lg: "h-7",
  xl: "h-8",
};

const SIZES = Object.keys(SIZE_HORIZONTAL_PADDING) as TButtonSize[];

/** `link` is the one variant that opts out of the size's horizontal padding. */
const PADDED_VARIANTS = VARIANTS.filter((variant) => variant !== "link");

/**
 * Split a class string into exact tokens. Substring matching is unsafe here — `text-on-color`
 * is a substring of `disabled:text-on-color-disabled`, and `bg-layer-2` is a substring of
 * `hover:bg-layer-2-hover` — so every assertion below compares whole tokens.
 */
function classTokens(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function expectClass(value: string, token: string): void {
  expect(classTokens(value)).toContain(token);
}

function expectNoClass(value: string, token: string): void {
  expect(classTokens(value)).not.toContain(token);
}

/**
 * Every utility that sets horizontal padding. `p-*`, `pl-*`/`pr-*` and their logical
 * counterparts count alongside `px-*` because tailwind-merge puts them in conflicting class
 * groups — if two of them reach the DOM together the outcome is decided by merge order
 * rather than by the config, which is exactly the failure mode these tests exist to catch.
 * Modifier-prefixed tokens (`hover:px-2`) are excluded: they only apply in that state.
 */
const HORIZONTAL_PADDING_PATTERN = /^-?(?:p|px|pl|pr|ps|pe)-/;

/** Whole-token filter, for the same reason `classTokens` exists — substrings lie here. */
function horizontalPaddingTokens(value: string): string[] {
  return classTokens(value).filter((token) => !token.includes(":") && HORIZONTAL_PADDING_PATTERN.test(token));
}

/** What a given pair should end up with: `link` is flush, everything else follows its size. */
function expectedHorizontalPadding(variant: TButtonVariant, size: TButtonSize): string {
  return variant === "link" ? "px-0" : SIZE_HORIZONTAL_PADDING[size];
}

describe("getButtonStyling", () => {
  describe("the primary variant keeps its enabled and disabled colours side by side", () => {
    it("emits both the accent background and the disabled background", () => {
      const styling = getButtonStyling("primary", "base");
      expectClass(styling, "bg-accent-primary");
      expectClass(styling, "disabled:bg-layer-disabled");
    });

    it("emits both the on-colour text and the disabled on-colour text", () => {
      const styling = getButtonStyling("primary", "base");
      expectClass(styling, "text-on-color");
      expectClass(styling, "disabled:text-on-color-disabled");
    });
  });

  describe.each(VARIANTS)("%s variant", (variant) => {
    const pair = VARIANT_COLOR_PAIRS[variant];

    it("keeps the enabled and disabled background utilities together", () => {
      const styling = getButtonStyling(variant, "base");
      if (pair.background === null || pair.disabledBackground === null) {
        // Text-only variant: assert it genuinely declares no background rather than silently passing.
        expect(classTokens(styling).filter((token) => token.includes("bg-"))).toEqual([]);
        return;
      }
      expectClass(styling, pair.background);
      expectClass(styling, pair.disabledBackground);
    });

    it("keeps the enabled and disabled text utilities together", () => {
      const styling = getButtonStyling(variant, "base");
      expectClass(styling, pair.text);
      expectClass(styling, pair.disabledText);
    });
  });
});

describe("cn() must not collapse a variant's enabled/disabled colour pair", () => {
  describe.each(VARIANTS)("%s variant", (variant) => {
    const pair = VARIANT_COLOR_PAIRS[variant];

    it("survives tailwind-merge with no className applied", () => {
      // `getButtonStyling` is plain clsx; `Button` runs the result through `cn()`, so the
      // merge step is where a bad extendTailwindMerge config would actually bite.
      const merged = cn(getButtonStyling(variant, "base"));
      if (pair.background !== null && pair.disabledBackground !== null) {
        expectClass(merged, pair.background);
        expectClass(merged, pair.disabledBackground);
      }
      expectClass(merged, pair.text);
      expectClass(merged, pair.disabledText);
    });

    it("survives tailwind-merge with a layout-only className applied", () => {
      const merged = cn(getButtonStyling(variant, "base"), "w-full");
      if (pair.background !== null && pair.disabledBackground !== null) {
        expectClass(merged, pair.background);
        expectClass(merged, pair.disabledBackground);
      }
      expectClass(merged, pair.text);
      expectClass(merged, pair.disabledText);
      expectClass(merged, "w-full");
    });
  });
});

describe("cn() with the sign-in button's real caller", () => {
  // apps/web/core/components/account/auth-forms/email.tsx renders
  // <Button type="submit" variant="primary" className="w-full" size="xl" />
  const signInClassName = cn(getButtonStyling("primary", "xl"), "w-full");

  it("keeps every primary colour utility", () => {
    expectClass(signInClassName, "bg-accent-primary");
    expectClass(signInClassName, "disabled:bg-layer-disabled");
    expectClass(signInClassName, "text-on-color");
    expectClass(signInClassName, "disabled:text-on-color-disabled");
  });

  it("applies the caller's own class", () => {
    expectClass(signInClassName, "w-full");
  });
});

describe("cn() with a genuinely conflicting className", () => {
  // Documents the intended tailwind-merge outcome rather than leaving it undefined:
  // the caller's class wins for the state it names, and only for that state.
  it("lets the caller's background win while the disabled background stays put", () => {
    const merged = cn(getButtonStyling("primary", "base"), "bg-danger-primary");
    expectNoClass(merged, "bg-accent-primary");
    expectClass(merged, "bg-danger-primary");
    expectClass(merged, "disabled:bg-layer-disabled");
    expectClass(merged, "disabled:text-on-color-disabled");
  });

  it("places the caller's background last so it wins the cascade", () => {
    const tokens = classTokens(cn(getButtonStyling("primary", "base"), "bg-danger-primary"));
    expect(tokens.indexOf("bg-danger-primary")).toBe(tokens.length - 1);
  });

  it("lets the caller's text colour win while the disabled text colour stays put", () => {
    const merged = cn(getButtonStyling("primary", "base"), "text-primary");
    expectNoClass(merged, "text-on-color");
    expectClass(merged, "text-primary");
    expectClass(merged, "disabled:text-on-color-disabled");
    expectClass(merged, "bg-accent-primary");
  });

  it("does not let a conflicting background disturb the enabled text colour", () => {
    const merged = cn(getButtonStyling("primary", "base"), "w-full bg-danger-primary");
    expectClass(merged, "text-on-color");
    expectClass(merged, "w-full");
  });
});

/**
 * Regression guard for the defect "a link-styled Button never gets the zero horizontal
 * padding it is written to have".
 *
 * The `link` variant declares `px-0`, but the `size` slots used to declare their own
 * `px-1.5`/`px-2`. cva concatenates base -> variant -> size -> compoundVariants with plain
 * `clsx`, so both landed in the emitted string with the size's value LAST, and `cn()`
 * (tailwind-merge) resolves same-group conflicts in favour of the last token — so `px-0` was
 * silently dropped and every link-styled button sat 8px away from adjacent inline text.
 * Two call sites had already papered over it by hand (`className="!p-0 …"` in
 * `apps/web/core/components/project/card.tsx`, a conditional `"p-0"` in
 * `apps/web/core/components/core/modals/existing-issues-list-modal.tsx`).
 *
 * The fix moves horizontal padding off the `size` slots and onto `compoundVariants` keyed on
 * (variant, size), so exactly one horizontal-padding utility is ever emitted. These tests
 * assert that "exactly one" property rather than the merged outcome alone, because a string
 * that merely merges to the right answer is one config change away from merging to the wrong
 * one — that reliance is the bug.
 */
describe("horizontal padding is unambiguous", () => {
  describe("the link variant is flush at every size", () => {
    describe.each(SIZES)("at size %s", (size) => {
      it("emits exactly one horizontal-padding utility, and it is the zero one", () => {
        expect(horizontalPaddingTokens(getButtonStyling("link", size))).toEqual(["px-0"]);
      });
    });
  });

  describe.each(PADDED_VARIANTS)("%s variant still takes its size's padding", (variant) => {
    describe.each(SIZES)("at size %s", (size) => {
      it("emits exactly the size's horizontal padding and nothing else", () => {
        expect(horizontalPaddingTokens(getButtonStyling(variant, size))).toEqual([SIZE_HORIZONTAL_PADDING[size]]);
      });
    });
  });

  /**
   * `link` keeps the size's `h-*`, deliberately. No call site overrides the height — the two
   * that fought the padding left it alone — and the link-styled `<Link>`s built from
   * `getButtonStyling("link", …)` sit in `flex items-center` rows next to fixed-height
   * controls, where a matching row height is what keeps them aligned. There is no `py-*` in
   * the config at all, so vertical padding was never part of this defect.
   */
  describe.each(SIZES)("the link variant keeps the size %s row height", (size) => {
    it("still emits the size's height utility", () => {
      expectClass(getButtonStyling("link", size), SIZE_HEIGHT[size]);
    });
  });
});

describe("cn() emits no horizontal-padding conflict for any variant/size pair", () => {
  describe.each(VARIANTS)("%s variant", (variant) => {
    describe.each(SIZES)("at size %s", (size) => {
      it("survives tailwind-merge with a single horizontal-padding utility", () => {
        // Exactly what `Button` computes: cn(buttonVariants({ variant, size }), className).
        const merged = cn(getButtonStyling(variant, size));
        expect(horizontalPaddingTokens(merged)).toEqual([expectedHorizontalPadding(variant, size)]);
      });

      it("lets a caller's own padding win outright", () => {
        const merged = cn(getButtonStyling(variant, size), "px-4");
        expect(horizontalPaddingTokens(merged)).toEqual(["px-4"]);
      });
    });
  });
});
