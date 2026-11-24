# Knock-On design

## Context and mode

Knock-On is a Jira issue panel (Forge Custom UI) used by a team lead or engineering manager in the middle of planning or a standup: "if this slips, what breaks?". It is an operate surface inside Jira, so it must read as part of Jira, not as a separate app glued into an iframe. Scanability and trust in the numbers outrank expression.

## Direction

Native chrome, owned signal.

- **Chrome** (text, surfaces, borders, buttons, focus, links) uses Atlassian design tokens (`--ds-*`) with light fallbacks, and the host's body font. When Jira enables theming (`view.theme.enable()`), the same tokens supply dark values.
- **Signal** is the part Knock-On owns: a four-state severity system used identically in the graph, the tally, the list markers, the badges and the release cards.

| State | Meaning | Fill / edge |
|---|---|---|
| root | the issue that slips | brand bold, inverse text |
| late | misses its due date because of this slip (or gets later) | danger background, danger border, danger text |
| already late | misses its date even with no slip | warning background / border / text |
| absorbs | slack absorbs the slip | success background / border / text |
| no due date | cannot be judged; shows how far it moves | dashed neutral border |

Red is only ever used for "this slip breaks something". Blue is only the slipping issue and the one primary action.

## Tokens

Defined at the top of `static/panel/src/styles.css`.

- Colour roles: `--ko-text`, `--ko-subtle`, `--ko-subtlest`, `--ko-border`, `--ko-border-strong`, `--ko-surface`, `--ko-raised`, `--ko-sunken`, `--ko-neutral(-hover)`, `--ko-brand(-hover)`, `--ko-on-brand`, `--ko-link`, `--ko-focus`, `--ko-selected(-bg)`, and the severity triples `--ko-late*`, `--ko-warn*`, `--ko-ok*`.
- Spacing: 4/8 scale, `--sp-1` 4 px, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 20, `--sp-6` 24, `--sp-8` 32. Groups sit `--sp-6` apart; items inside a group `--sp-2`–`--sp-3`; the footer is pushed off by `--sp-8`.
- Type: 11 / 12 / 14 / 18 px; body line height 1.45, headings 1.3; weights 400, 500, 600, 650. Numbers that change (dates, counts, slip) use tabular numerals.
- Radius: 4 px (controls, badges), 8 px (graph well, release cards, empty states), pill (chips, people).
- Shadows: only the slider thumb (`--shadow-thumb`); everything else is flat on Jira's surface.

## Hierarchy

1. **Focus point:** the headline sentence ("If CHK-12 slips 5 business days, 5 of 7 downstream issues miss their due date and 1 release is at risk.") at 18 px / 650, with the damaging numbers in danger red. Directly under it, the graph well is the visual hero.
2. The slip control is the one input that matters: a full-width slider whose fill is the danger colour, a number field for exact values, and four quick-pick chips.
3. Details recede: releases, then broken due dates, then already-late, absorbed, undated, then who to tell.
4. **One primary action:** "Post forecast to KEY" in the footer, the only brand-filled button.

## Motion

One authored moment: **the slip spreads**. When the slip changes, each graph node's fill and border transition (260 ms, `ease`) with a delay of 70 ms per column (`--ripple` × depth), and edges into late issues turn red on the same schedule. The red visibly travels downstream from the slipping issue. Transitions retarget when the slider is dragged, so it stays interruptible.

Supporting motion, all 150–420 ms with `cubic-bezier(0.23, 1, 0.32, 1)`:

- First load: summary, graph and details rise 6 px and fade in, 60 ms apart; graph nodes pop in column by column (90 ms per column) while their edges draw left to right (`stroke-dashoffset`).
- Loading: a breathing skeleton, not a spinner.
- Press feedback: chips `scale(0.96)`, primary button `scale(0.97)`, slider thumb grows to 1.15 while held. Hover effects only under `(hover: hover) and (pointer: fine)`.
- Posting: the button label breathes while busy; the confirmation rises in.
- Lists re-render on every slip change without animation, because they change many times a second while dragging.
- `prefers-reduced-motion`: ripple delay 0, no movement, entrances become 200 ms fades, no skeleton or busy pulse.

## States

Skeleton while the graph loads; empty state when nothing depends on the issue; done state when the issue is finished; error state with the reason and a retry; posting / posted / failed for the comment. Dependency loops, truncated graphs and outside blockers get an inline note with an icon.

## Icons

Inline SVG, 16 px, 1.5–1.8 px stroke, round caps: arrow, comment, check, alert, link. No glyphs or emoji stand in for icons.

## Responsive

Designed for Jira's issue column (about 600–900 px). Below 560 px the list rows stack dates and badges under the summary, the headline drops to 16 px, and the graph scrolls horizontally with a fade on the right edge until scrolled to the end.

## Not verified

Dark mode depends on Jira's injected tokens and was not seen running; locally only the light fallbacks render.
