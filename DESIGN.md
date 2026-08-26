# KIRAN Design Language

The shared visual system for KIRAN products — the chat workspace, the project
management app, and whatever we build next.

This is a working document, not a monument. Change the numbers when they stop
serving us; just change them **here first**, then in code, so this file stays
the source of truth rather than a description of what the code used to do.

- **Version** 1.1
- **Last updated** 25 August 2026
- **Applies to** `CHATROOM-FINAL-main/nexus-chat`, `KIRAN-MGMT-main`

---

## Contents

1. [The idea in one paragraph](#1-the-idea-in-one-paragraph)
2. [Six principles](#2-six-principles)
3. [Colour](#3-colour)
4. [The brand gradient (and its one trap)](#4-the-brand-gradient-and-its-one-trap)
5. [Glass](#5-glass)
6. [The ambient field](#6-the-ambient-field)
7. [Shape](#7-shape)
8. [Type](#8-type)
9. [Motion](#9-motion)
10. [Accessibility rules that are not negotiable](#10-accessibility-rules-that-are-not-negotiable)
11. [How this maps onto each codebase](#11-how-this-maps-onto-each-codebase)
12. [Adding a new product](#12-adding-a-new-product)
13. [Review checklist](#13-review-checklist)
14. [Changelog](#14-changelog)

---

## 1. The idea in one paragraph

**One blue, many depths.** Almost every colour in a KIRAN product is a blue.
Hierarchy is built from lightness and transparency within that single hue
family rather than from a second accent colour. Surfaces are translucent and
blurred rather than solid, so depth reads as *material* — panes of glass over a
slowly drifting field of light — instead of as borders and drop shadows. The
result should feel premium and calm, dense enough for professional daily use,
and never like a stock admin template.

If a change makes the product louder, add a second accent hue, or replace blur
with borders, it is probably fighting this system.

---

## 2. Six principles

**One hue, many depths.** Build hierarchy from lightness and alpha inside the
blue family. A second accent hue needs a real justification — status colours
(success, warning, danger) and user-chosen label colours are the exceptions, and
they are deliberately *not* part of the brand palette.

**Translucency is structure.** Chrome and floating panels are alpha-blended and
blurred. That is what separates them from content, not a heavier border.

**Gradient means identity.** The cyan-to-indigo gradient marks "this is KIRAN"
or "this is you". It belongs on logos, your own message bubbles, and brand
moments. It is not a decorative fill for arbitrary panels.

**Ambient, not animated.** Background motion runs on 18–24 second loops. If a
person notices it moving, it is too fast.

**Dense by default.** These are tools people live in for eight hours. 13px base,
10–11px metadata. Closer to Linear and Slack than to a consumer app.

**Depth costs performance, so spend it on chrome.** Blur is applied to frame
chrome and floating panels only. Never to list rows, table cells, kanban cards,
or anything that appears hundreds of times in a scroll container.

---

## 3. Colour

Both modes are first-class. Neither is a filter applied to the other — each was
picked against its own ground and measured there.

### 3.1 The two grounds

| Role            | Light     | Dark      | Notes                                   |
| --------------- | --------- | --------- | --------------------------------------- |
| App background  | `#eaf6ff` | `#030812` | The canvas. Light blue vs near-black navy |
| Raised surface  | `#ffffff` | `#061022` | Cards, panels, sheets                    |
| Primary text    | `#102342` | `#edf7ff` |                                          |
| Secondary text  | `#3e5372` | `#becfde` |                                          |
| Muted text      | `#58708f` | `#91aac2` |                                          |
| Brand primary   | `#176ee8` | `#43a8ff` | Accent lightness **rises** in dark       |
| Focus ring      | `#168eea` | `#4bc5ff` |                                          |
| Success         | `#079455` | `#35d08a` |                                          |
| Danger          | `#d92d3e` | `#f4677a` |                                          |
| AI / assistant  | `#087edc` | `#65c8ff` |                                          |
| Border          | `#4c89cf` @ 24% | `#58a7e8` @ 21% | Low-contrast by design       |

### 3.1.1 Text on a coloured fill — the rule that flips

This is the single most common dark-mode mistake, and it is worth stating
separately: **which ink goes on a saturated fill depends on the theme.**

In light mode the "primary" fills (accent, success, danger) are *dark* colours,
so they take **light ink**. In dark mode those same fills are *light* colours —
`#43a8ff`, `#05df72`, `#ff6467` — so they must take **dark ink**.

| Fill              | Light mode ink | Dark mode ink        |
| ----------------- | -------------- | -------------------- |
| Accent / primary  | near-white     | near-black navy      |
| Success           | near-white     | near-black navy      |
| Danger            | near-white     | near-black navy      |

Carrying light ink into dark mode measures 2.03:1 on the accent and 1.43:1 on
success. Switching to dark ink takes those to 7.91:1 and 11.27:1.

One exception, because it catches people out: **disabled** text on a coloured
control does *not* follow this rule. A disabled control sits on a neutral grey
(`bg-layer-disabled`), not on a saturated fill, so in dark mode it keeps *light*
ink. Same theme, opposite answer, because the background underneath is different.

### 3.2 Dark mode is not an inversion

This is the rule people get wrong most often. When moving to the dark ground,
**raise accent lightness** so accents keep the same optical weight:

```
primary   #176ee8  ->  #43a8ff     (lighter, slightly less saturated)
success   #079455  ->  #35d08a
danger    #d92d3e  ->  #f4677a
```

A dark theme that reuses the light theme's accents will look muddy and dead.
A dark theme built by inverting lightness will look like a photo negative. Pick
each dark value by asking *"does this pop as much against near-black as the
light value does against near-white?"*

### 3.3 Neutrals carry blue

Our neutrals are **not** grey. They sit at OKLCH hue **240–260**, and the faint
blue cast is what makes them feel like part of the palette rather than a
default.

The two ramps move in opposite directions, and the chroma curve differs because
the eye needs different things on each ground:

| | Light ramp | Dark ramp |
| --- | --- | --- |
| Lightest end | `oklch(1 0 0)` pure white — surfaces | `oklch(0.971 0.015 242)` `#edf7ff` — text |
| Darkest end | `oklch(0.2378 0.06 259)` — text | `oklch(0.1334 0.0255 257)` `#030812` — canvas |
| Chroma | rises as it darkens, `0.006 → 0.060` | peaks in the mid-tones, `0.026 → 0.043 → 0.015` |
| Hue drift | `239 → 259` as it darkens | `260 → 242` as it lightens |

Light gets its saturation in the *ink*; dark gets it in the *mid-tones*, because
a near-black canvas and near-white text both want to stay close to neutral or
they start to look tinted.

When you need a new neutral step, keep the lightness ladder you already have and
interpolate chroma and hue along that curve. **Avoid changing a neutral's
lightness to fix a colour problem** — the lightness ladder is what encodes
depth, and moving it shifts every surface built on top of it. (Two deliberate
exceptions are recorded in the changelog: the light canvas step was raised to
land exactly on `#eaf6ff`, and the light placeholder step was darkened to clear
contrast. Both were checked against the whole ladder afterwards.)

### 3.4 What is off-limits to the brand palette

- **Status colours** — success/warning/danger must stay recognisably green /
  amber / red. Do not blue-shift them into the brand family.
- **User label colours** — people pick these for their own projects and tags.
  They are data, not design.
- **Syntax highlighting** — legibility beats palette coherence in a code block.

---

## 4. The brand gradient (and its one trap)

The signature is cyan → blue → indigo at **135°**.

```css
--gradient-brand: linear-gradient(135deg, #16bce9 0%, #217de8 48%, #334cbe 100%);
```

### The trap

A gradient travels in lightness; a text colour does not. Put white text on the
gradient above and it measures **2.23:1** at the cyan stop — a clear WCAG
failure — while passing comfortably at the indigo end. Because the gradient runs
135° (top-left to bottom-right), the cyan sits under the *first line of text*.
The dark-theme variant fails at the opposite end for the same reason.

### The rule

**Keep two gradients and know which one you are using.**

```css
/* DECORATIVE ONLY — never put text on this */
--gradient-brand: linear-gradient(135deg, #16bce9 0%, #217de8 48%, #334cbe 100%);

/* SAFE FOR TEXT — white clears 4.5:1 across the entire ramp (4.73:1 at its
   lightest point). Same movement, pulled down in lightness. */
--gradient-brand-safe: linear-gradient(135deg, #007ca7 0%, #006cdb 50%, #344cbe 100%);
```

Dark-theme equivalents:

```css
--gradient-brand: linear-gradient(135deg, #1bc7e9 0%, #2589ec 50%, #4554ce 100%);
--gradient-brand-safe: linear-gradient(135deg, #0086b4 0%, #0d74e0 50%, #3d55c6 100%);
```

Use `--gradient-brand` for logos, ambient orbs, and empty-state art. Use
`--gradient-brand-safe` for anything carrying text — buttons, banners, message
bubbles.

> If you invent a new gradient, measure contrast at **both** end stops before
> shipping it, not just the one you happened to screenshot.

---

## 5. Glass

Three recipes, in descending strength. Everything else is opaque.

### 5.1 Chrome — `blur(24px) saturate(145%)`

Frame edges: top bar, side rail, sidebar, composer bar. These sit directly over
the ambient field and get the strongest blur.

```css
background: color-mix(in srgb, var(--surface) 78%, transparent);
backdrop-filter: blur(24px) saturate(145%);
-webkit-backdrop-filter: blur(24px) saturate(145%);
```

### 5.2 Panel — `blur(22px) saturate(135%)`

Floating things: dialogs, dropdown menus, popovers, command palettes, context
menus. More opaque than chrome because they carry dense text.

```css
background: color-mix(in srgb, var(--surface) 86%, transparent);
backdrop-filter: blur(22px) saturate(135%);
box-shadow: var(--shadow-float);
```

### 5.3 Raised — `blur(12px) saturate(120%)`

A hint of glass for a card that needs to lift off its surface. Use sparingly.

### 5.4 Where glass must not go

- List rows, table cells, kanban cards, gantt bars, spreadsheet cells
- Anything inside a virtualised scroll container
- Anything that renders more than ~20 times on screen
- **The high-contrast themes**, in full — people choose those because they need
  maximum foreground/background separation, and blur is the opposite of that

### 5.5 Always provide the fallback

`backdrop-filter` is not universal, and it silently degrades to *transparent*,
not to *opaque*. Always pair it:

```css
@supports not (backdrop-filter: blur(1px)) {
  .chrome { background: var(--canvas); }
  .panel  { background: var(--surface); }
}
```

### 5.6 Shadows

```css
--shadow-soft:  0 1px 2px  oklch(0.32 0.06 255 / 8%),  0 12px 30px -20px oklch(0.42 0.09 255 / 32%);
--shadow-float: 0 24px 60px -28px oklch(0.35 0.08 255 / 40%);
```

Shadows are blue-tinted, never neutral black. In dark mode they go to true
black at higher opacity, since a tinted shadow on near-black does nothing.

---

## 6. The ambient field

Blur needs something behind it. Without an ambient field, translucent chrome
blurs a flat colour and reads as dull grey — you pay the performance cost and
get none of the effect.

Paint **two** blurred orbs behind the app shell, once, at the root:

```css
.ambient { position: relative; isolation: isolate; }

.ambient::before,
.ambient::after {
  position: absolute;
  z-index: -1;
  content: "";
  border-radius: 999px;
  pointer-events: none;
  filter: blur(12px);
}

.ambient::before {
  top: -20rem; left: 12%; width: 44rem; height: 44rem;
  background: radial-gradient(circle, oklch(0.72 0.13 224 / 26%) 0%, transparent 68%);
  animation: drift 19s ease-in-out infinite alternate;
}

.ambient::after {
  right: -16rem; bottom: -24rem; width: 50rem; height: 50rem;
  background: radial-gradient(circle, oklch(0.52 0.18 264 / 22%) 0%, transparent 68%);
  animation: drift 24s ease-in-out -7s infinite alternate-reverse;
}
```

Two rules: give the orbs **different durations** (19s and 24s — never the same,
or they pulse in lockstep and read as a heartbeat), and give the second a
**negative delay** so they are out of phase from the first frame.

`isolation: isolate` on the parent is required. Without it the `z-index: -1`
pseudo-elements escape behind the parent's own background and vanish.

---

## 7. Shape

Base radius **12px** (`0.75rem`), stepping:

| Token | Value | Used for                          |
| ----- | ----- | --------------------------------- |
| `sm`  | 8px   | Badges, chips, small controls      |
| `md`  | 10px  | Inputs, buttons                    |
| `lg`  | 12px  | Cards, dropdowns                   |
| `xl`  | 16px  | Message bubbles, dialogs           |
| `2xl` | 20px  | Large panels                       |
| `3xl` | 24px  | Hero surfaces                      |

**Speech-bubble exception:** a message bubble uses `xl` on three corners and
`sm` on the corner nearest its author — 16px/16px/16px/8px. That single asymmetry
is what makes it read as speech rather than as a card.

Borders are **1px** and low-contrast — around 21–24% alpha of a mid-blue. In
this system borders *hint* at an edge; blur and shadow do the actual separating.

---

## 8. Type

**Inter**, everywhere, `font-variant-numeric: tabular-nums` globally so digits
line up in tables and timestamps.

| Size | Weight  | Used for                             |
| ---- | ------- | ------------------------------------ |
| 9px  | 600     | Status micro-badges, uppercase       |
| 10px | 400     | Timestamps, keyboard hints           |
| 11px | 500/600 | Sender names, previews, roles, meta  |
| 13px | 400/500 | **Base** — all chrome, controls      |
| 14px | 400     | Message and document body text       |
| 16px | 500     | Section titles                       |
| 20px+| 600     | Page titles, empty-state headings    |

Headings carry `-0.015em` letter-spacing. Uppercase micro-labels get `+0.06em`
— uppercase always needs positive tracking to stay readable.

> **Known gap, worth closing.** We declare a `--font-display` token but point it
> at the same Inter stack as `--font-sans`, so the display role exists in name
> only. If we ever want real typographic contrast, that token is where a second
> face would go. Until then, do not pretend the distinction is doing anything.

---

## 9. Motion

| Name               | Duration    | Role                                        |
| ------------------ | ----------- | ------------------------------------------- |
| `msg-in`           | 0.28s       | Content arrives: rise 8px, scale from 0.985 |
| `logo-arrive`      | 0.6s        | Brand mark on load                          |
| `pulse-ring`       | 2s loop     | Online / live status dots                   |
| `ai-glow`          | 2.4s loop   | Assistant is thinking, 0.72 → 1 opacity     |
| `gradient-breathe` | 18s loop    | Canvas gradient drifts its position         |
| `drift`            | 19s / 24s   | Ambient orbs                                |

Standard easing for arrivals is `cubic-bezier(0.22, 1, 0.36, 1)` — fast out,
soft landing.

**Every animation must be gated:**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 10. Accessibility rules that are not negotiable

1. **Body text clears 4.5:1. UI and large text clear 3:1.** No exceptions for
   aesthetics.
2. **Measure gradients at both ends.** A gradient that passes at one stop and
   fails at the other is a failing gradient. See [§4](#4-the-brand-gradient-and-its-one-trap).
3. **Focus is always visible.** Our ring:
   ```css
   outline: 2px solid color-mix(in srgb, var(--ring) 42%, transparent);
   outline-offset: 2px;
   ```
   Applied to every button, link, input and textarea. Never `outline: none`
   without a replacement.
4. **High-contrast themes stay solid.** No blur, no translucency, no ambient
   field.
5. **Reduced motion is respected everywhere**, including decorative background
   animation.
6. **Colour is never the only signal.** Pair status colour with an icon, a
   label, or a shape.

### 10.1 Measuring colour through an automated browser

Half a day was lost to a defect that did not exist, so this is a rule now.

**A browser page that is not displayed runs with `document.hidden === true`,
which freezes `document.timeline`.** Every CSS transition then parks at its
start frame permanently: `getAnimations()` reports `playState: "running"` with a
`currentTime` of `0` that never advances, and `requestAnimationFrame` never
fires. Anything measured with `getComputedStyle` in that state is the colour the
element was transitioning *away from*.

This is exactly how propel's primary Button came to be recorded as "renders with
disabled colours while genuinely enabled". It does not. Its `transition-colors`
was mid-fade from the disabled grey to the accent blue, and the frozen timeline
held it on frame one.

The tell-tale is the colour space. A static rule computes to **`oklch(...)`** —
the authored value. A transition in flight computes to an interpolated
**`oklab(...)`**. If a measurement comes back in `oklab` and you did not author
`oklab`, you are reading a transition, not a cascade.

Before trusting any colour measured through an automated browser:

```js
document.hidden                                   // must be false, or:
el.getAnimations().forEach((a) => a.finish());    // settle transitions, then measure
el.style.transition = "none";                     // or remove them outright
```

And confirm anything animated by eye in a real browser before recording it as a
defect.

---

## 11. How this maps onto each codebase

The two products express the same system through different token layers. That is
fine — what must match is the *resulting colour and behaviour*, not the variable
names.

### 11.1 `nexus-chat` (chat workspace)

**Stack** React 19, TanStack Start, Tailwind v4, shadcn/ui.
**Token file** [`src/styles.css`](CHATROOM-FINAL-main/nexus-chat/src/styles.css)

Tokens are plain custom properties on `:root` and `.dark`, bridged into Tailwind
with `@theme inline`. Utilities are declared with `@utility`:

```css
@utility glass {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-soft);
  backdrop-filter: blur(22px) saturate(135%);
}
```

Theme switching is a `.dark` class on `<html>`, driven by
[`src/lib/theme.tsx`](CHATROOM-FINAL-main/nexus-chat/src/lib/theme.tsx), with
light / dark / system and a `localStorage` preference.

### 11.2 `KIRAN-MGMT` (project management)

**Stack** Plane monorepo — React, Next/React-Router, Tailwind v4, pnpm + turbo.
**Token file** [`packages/tailwind-config/variables.css`](KIRAN-MGMT-main/packages/tailwind-config/variables.css)
**Glass file** [`packages/tailwind-config/glass.css`](KIRAN-MGMT-main/packages/tailwind-config/glass.css)

This app has its own **semantic layering model** that sits on top of our palette,
and it is genuinely good — keep using it:

```
Canvas   (bg-canvas)      the single application background. Used ONCE, at the root.
Surface  (bg-surface-1..3) top-level containers sitting on the canvas. Siblings, never nested.
Layer    (bg-layer-1..3)   depth within a surface. Match the number: surface-1 -> layer-1.
```

Hover states must match their base (`bg-layer-1 hover:bg-layer-1-hover`). Text
uses `text-primary` / `text-secondary` / `text-tertiary` / `text-placeholder`.
Borders use `border-subtle` / `border-strong`. The full rules live in
[`packages/tailwind-config/AGENTS.md`](KIRAN-MGMT-main/packages/tailwind-config/AGENTS.md).

Colours are defined as **primitive ramps** (`--neutral-*`, `--brand-*`) which
every semantic token derives from. **To retheme this app, change only the
primitives.** Everything downstream follows, and no component needs editing.

This app ships **five** themes, switched by `data-theme` on `<html>`:

| Theme            | Status                                                     |
| ---------------- | ---------------------------------------------------------- |
| `light`          | KIRANOS light. Canvas `#eaf6ff`, surfaces white            |
| `dark`           | KIRANOS dark. Canvas `#030812`, surfaces `#071021`          |
| `light-contrast` | Accessibility. Inherits the palette, **no glass, no orbs**  |
| `dark-contrast`  | Accessibility. Same                                         |
| `custom`         | User-defined. Left alone entirely                           |

The two contrast themes only override *border* tokens on top of light/dark, so
they pick up palette changes automatically — which is why they must be opted out
of glass explicitly rather than by omission.

**Theme plumbing, and three things that quietly break it.** Themes are driven by
`next-themes` in `apps/web/app/root.tsx`.

1. **Always pass `attribute="data-theme"` explicitly.** Every selector in the
   system keys off `[data-theme]`, but `next-themes` only defaults to that
   attribute as of 0.4.x — it was `class` in 0.3.x, and the default is not a
   documented guarantee. Leaving it implicit means a minor version bump can
   unstyle the entire product with no error.
2. **A theme being *in effect* is not the same as a theme being *selected*.** On
   a fresh account the saved profile theme is empty and the provider falls back
   to `system`. Any UI that derives "current theme" from the saved profile value
   alone will show an empty/placeholder state and read as *"there is no theme
   set, and no light mode"* — even though the app is themed. Always fall back:
   saved value → active provider theme → resolved theme.
3. **Switching a built-in theme must not reload the page.** All five themes are
   token swaps behind `[data-theme]`, so setting the attribute repaints
   everything synchronously; a `window.location.reload()` on switch makes the
   feature feel broken. Only the `custom` theme needs a remount, because it
   writes its palette imperatively.

Also set `theme-color` per scheme, or the browser chrome stays light while the
app is dark:

```html
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#eaf6ff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)"  content="#030812" />
```

Verified in the running app, both themes, zero WCAG AA text failures:

```
light   canvas #eaf6ff   surface #ffffff   ink #0c1e3b   accent #176ee8
dark    canvas #030812   surface #071021   ink #dbe8f2   accent #43a8ff
```

Glass is applied through four utility classes:

| Class                    | Applies to                                            |
| ------------------------ | ----------------------------------------------------- |
| `kx-chrome`              | App rail, top navigation, space navbar                |
| `kx-panel`               | Dialogs, dropdown menus, context menus                |
| `kx-raised`              | Opt-in raised cards                                   |
| `kx-ambient`             | App shell root — paints the orb field                 |
| `kx-brand-gradient`      | Decorative only                                       |
| `kx-brand-gradient-safe` | Gradient surfaces carrying text                       |

Because dialogs and menus live in the shared `@plane/propel` package, glassing
them there reaches the web, space and admin apps at once.

---

## 12. Adding a new product

1. Copy the two grounds and the accent set from [§3](#3-colour). Do not
   re-pick blues by eye — use these exact values.
2. Build the neutral ramp with blue chroma per [§3.3](#33-neutrals-carry-blue).
   Set the lightness ladder first, then apply the chroma/hue curve.
3. Define both gradients from [§4](#4-the-brand-gradient-and-its-one-trap).
   Both. Not just the pretty one.
4. Add the three glass recipes from [§5](#5-glass) — plus the `@supports`
   fallback in the same commit, not later.
5. Paint the ambient field at the root ([§6](#6-the-ambient-field)).
6. Set the radius and type scales ([§7](#7-shape), [§8](#8-type)).
7. Add the reduced-motion block and the focus ring
   ([§10](#10-accessibility-rules-that-are-not-negotiable)).
8. Run the checklist below before you call it done.

---

## 13. Review checklist

Colour

- [ ] Every colour comes from a token; no hex literals in component files
- [ ] Dark mode raises accent lightness rather than inverting
- [ ] Neutrals carry blue chroma, not grey
- [ ] Status and label colours were left alone
- [ ] Ink on coloured fills flips per theme (light ink on light mode's dark
      fills, dark ink on dark mode's light fills) — see [§3.1.1](#311-text-on-a-coloured-fill--the-rule-that-flips)
- [ ] Disabled-on-colour was checked separately — it sits on grey, not on the fill

Contrast

- [ ] Body text ≥ 4.5:1 in both themes
- [ ] UI and large text ≥ 3:1 in both themes
- [ ] Any gradient carrying text measured at **both** end stops
- [ ] Placeholder and disabled text checked, not assumed

Glass

- [ ] Blur is on chrome and floating panels only
- [ ] No blur inside scroll containers or repeated rows
- [ ] `@supports not (backdrop-filter)` fallback present
- [ ] High-contrast themes opted out entirely
- [ ] An ambient field exists behind the blur — otherwise remove the blur

Motion

- [ ] Ambient loops ≥ 18s, with differing durations and a phase offset
- [ ] `prefers-reduced-motion` respected, decorative animation included

Shape and type

- [ ] Radii come from the scale
- [ ] Base is 13px; metadata 10–11px
- [ ] `tabular-nums` on anything numeric that aligns in a column
- [ ] Uppercase labels have positive letter-spacing

Focus

- [ ] Every interactive element has a visible focus state
- [ ] No bare `outline: none`

---

## 14. Changelog

### 1.1 — 25 August 2026

Light and dark both tuned and measured in the running PM app. Both now report
**zero WCAG AA text failures**.

- **Light canvas now matches the chat app exactly.** Raised the light
  `neutral-300` step to `oklch(0.9668 0.0176 240)` so the canvas lands on
  `#eaf6ff` rather than the `#e7f2fa` it had drifted to. `neutral-100` and
  `neutral-200` were raised with it to keep canvas → layer-1 → surface-1
  separation.
- **Fixed light-mode placeholder contrast.** `neutral-900` (which backs
  `--txt-placeholder`, tertiary icons and secondary links) measured 3.68:1 on
  white and 3.35:1 on canvas. Darkened to `oklch(0.545 0.051 255)`, now 4.94 /
  4.50 / 4.65 across white, canvas and layer-1. This was pre-existing, not
  introduced by the retheme.
- **Fixed dark-mode ink on coloured fills.** `--txt-on-color` was a light
  colour, but every dark-mode primary fill is itself light — measured 2.03:1 on
  accent, 1.43:1 on success, 2.32:1 on danger, 1.71:1 on warning. Switched to
  dark ink: 7.91 / 11.27 / 6.94 / 9.39. Documented as a rule in
  [§3.1.1](#311-text-on-a-coloured-fill--the-rule-that-flips).
- **Reverted one over-reach.** `--txt-on-color-disabled` was changed to dark ink
  in the same pass and had to be put back — it sits on a neutral grey, not on a
  coloured fill, so the rule does not apply to it. Caught by running the app.
- Documented the five shipped themes and the light/dark neutral ramps
  side by side.
- **Fixed the "there is no light mode" perception**, which was plumbing rather
  than palette. On a fresh account the theme control derived its value only from
  the saved profile theme, which is empty, so it rendered a "select your theme"
  placeholder — the app looked unthemed and offered no visible light option. It
  now falls back to the active provider theme, then the resolved one.
- Pinned `attribute="data-theme"` on the theme provider instead of relying on a
  `next-themes` default that changed between minor versions.
- Dropped the forced page reload on switching a built-in theme, and made
  `theme-color` scheme-aware.

### 1.0 — 25 August 2026

- First version. Extracted from the `nexus-chat` implementation, audited
  against the running app, and applied to `KIRAN-MGMT`.
- **Corrected the brand gradient.** The original single gradient failed WCAG AA
  with white text at its cyan stop (2.23:1). Split into a decorative gradient
  and a text-safe gradient that clears 4.5:1 across its whole ramp.
- Recorded the `--font-display` / `--font-sans` duplication as a known gap
  rather than presenting the display role as functional.
