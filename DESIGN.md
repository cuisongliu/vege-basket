---
name: Veges
description: A restrained daily cockpit for project context and delivery work.
colors:
  canvas-light: "oklch(0.9934 0.0017 174.5350)"
  surface-light: "oklch(1 0 0)"
  ink-light: "oklch(0.2464 0.0358 168.9829)"
  muted-ink-light: "oklch(0.5836 0.0427 172.2348)"
  line-light: "oklch(0.9161 0.0142 174.1306)"
  brand-green-light: "oklch(0.5048 0.0836 176.32)"
  canvas-dark: "oklch(0.1822 0 0)"
  surface-dark: "oklch(0.2046 0 0)"
  ink-dark: "oklch(0.9288 0.0126 255.5078)"
  line-dark: "oklch(0.2809 0 0)"
  brand-green-dark: "oklch(0.6631 0.0889 173.12)"
  destructive: "oklch(0.6356 0.2082 25.3782)"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.16
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 450
    lineHeight: 1.6
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 560
    lineHeight: 1.35
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 450
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-green-light}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  input-default:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "34px"
  panel-default:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.md}"
    padding: "14px"
---

# Design System: Veges

## Overview

**Creative North Star: "The Daily Workbench"**

Veges is a task surface, not a presentation surface. Its visual system uses compact controls, stable panels, clear labels, and restrained green accents so users can scan projects and move between journal, todo, notification, and delivery work without relearning the interface.

The default experience supports both dark and light themes. Depth comes mostly from borders and tonal separation. Accent color is reserved for primary actions, current state, status dots, and small notification signals. The system rejects marketing composition, decorative card grids, enterprise process ornament, noisy activity feeds, purple gradients, glass effects, and decorative motion.

**Key Characteristics:**

- Dense but ordered project navigation.
- Familiar 32 to 34px controls with explicit states.
- White or near-black surfaces separated by quiet borders.
- Green used as a status and action signal, not as decoration.
- Project content receives more space than navigation chrome.

## Colors

The palette combines neutral work surfaces with a green action signal. Light mode is nearly neutral with a slight green cast; dark mode is graphite with desaturated green.

### Primary

- **Workbench Green** (`oklch(0.5048 0.0836 176.32)` light, `oklch(0.6631 0.0889 173.12)` dark): Primary actions, selected state, notification counts, and availability indicators.

### Neutral

- **Light Canvas** (`oklch(0.9934 0.0017 174.5350)`): Page background in light mode.
- **Light Surface** (`oklch(1 0 0)`): Panels, inputs, popovers, and cards in light mode.
- **Graphite Canvas** (`oklch(0.1822 0 0)`): Page and sidebar background in dark mode.
- **Graphite Surface** (`oklch(0.2046 0 0)`): Panels and cards in dark mode.
- **Quiet Line** (`oklch(0.9161 0.0142 174.1306)` light, `oklch(0.2809 0 0)` dark): Borders and separators.
- **Danger Red** (`oklch(0.6356 0.2082 25.3782)`): Destructive actions and error text only.

**The Signal Rule.** Workbench Green marks action or state. It should not become a page background or decorative wash.

### Editor Semantic Colors

Editor color communicates meaning rather than decoration. Primary green is limited to document selection and focus states; active formatting controls use neutral gray. Authored highlights use amber, links use blue, and blockquotes plus inline code use neutral tones. Syntax highlighting may use a controlled multicolor token palette, but it must remain scoped to code, avoid pink as a dominant token color, and preserve readable contrast in both themes.

## Typography

- **Display Font:** Geist with system sans-serif fallback
- **Body Font:** Geist with system sans-serif fallback
- **Label/Mono Font:** Geist Mono with system monospace fallback

**Character:** One compact sans family carries the interface. Weight and spacing create hierarchy without introducing a display voice that competes with project content.

### Hierarchy

- **Display** (700, 30px, 1.16): Page and project titles on full workspace surfaces.
- **Headline** (680, 22px, 1.2): Panel headings and prominent task titles.
- **Title** (600, 16px, 1.35): Card, dialog, and section titles.
- **Body** (450, 14px, 1.6): Explanatory copy, journals, notes, and form help. Keep prose near 70 characters per line where layout permits.
- **Label** (560, 13px, 1.35): Form labels, metadata, and compact control text.

**The Working Type Rule.** Labels, buttons, and data use the same sans vocabulary. Do not introduce display fonts, uppercase tracking, or fluid viewport-scaled text inside the workspace.

## Elevation

Surfaces are flat by default. Borders and background changes provide most separation. Use the existing small ambient shadows only for popovers, menus, and raised transient UI; persistent panels should not combine wide shadows with decorative borders.

### Shadow Vocabulary

- **Ambient Small** (`0 4px 12px hsl(160 50% 10% / 0.06)`): Popovers and menus in light mode.
- **Dark Small** (`0 1px 3px hsl(0 0% 0% / 0.17)`): Popovers and menus in dark mode.

**The Flat Workbench Rule.** Persistent workspace panels use tonal separation and a 1px border. Elevation is reserved for content that temporarily sits above the workspace.

## Components

### Buttons

- **Shape:** Compact rectangle with a 6px radius and 32px height.
- **Primary:** Workbench Green background, white text, 10px horizontal padding.
- **Hover / Focus:** Darken the existing green slightly; use a visible ring or border shift for keyboard focus.
- **Secondary / Ghost:** Surface background, quiet border, strong text; muted background on hover.

### Chips

- **Style:** Pill radius for tags, counts, status, and filters only. Use a quiet border or muted fill and keep labels short.
- **State:** Selected chips may use the brand color; inactive chips remain neutral.

### Cards / Containers

- **Corner Style:** 8px for standard panels, 10px for account and focused tool surfaces.
- **Background:** Theme surface token.
- **Shadow Strategy:** Flat at rest; use the Elevation vocabulary only for transient layers.
- **Border:** 1px Quiet Line.
- **Internal Padding:** 14px for dense panels, 24px for login and dialog surfaces.

### Inputs / Fields

- **Style:** 34px height, 6 to 8px radius, surface background, 1px Quiet Line border.
- **Focus:** Brand-tinted border and a narrow focus ring.
- **Error / Disabled:** Error state uses Danger Red in text and border; disabled controls reduce opacity but keep labels readable.

### Navigation

Sidebar rows are 32px high with a 6px radius, left-aligned icon and label, and a muted active background. Counts sit in compact pills at the row end. On narrow screens, navigation and dense workspace regions collapse structurally rather than shrinking type.

### Account Settings

Treat account settings as a stable settings center, not a status overview or one long form. Opening the dialog shows Personal Profile immediately; a narrow category rail keeps Personal Profile, Feishu Notifications, and Login Security available while one focused editor occupies the main panel. Use tonal separation, flat rows, and dividers instead of nested cards. Each category owns its validation, loading, error, success, and save state, and successful saves stay in place. On narrow screens, move the category rail above the editor and keep one scrolling content region with stable actions.

### Veges AI

Treat Veges AI as one task canvas, not a collection of feature panels. The empty conversation may show one row of three equal prompt cards; each example sends a complete natural-language message through the same composer path instead of selecting a visible capability or mode. On narrow screens the same row scrolls horizontally rather than compressing card text. Project summaries, pasted-Markdown todo extraction, and conversation analysis are still routed internally. The composer uses one quiet two-level surface: an expandable text area above, then optional context chips and a bottom toolbar. Attachment and `@` controls stay at the lower left, while the primary send action stays at the lower right.

Selected projects and text attachments appear as compact removable chips inside the composer, never as a second toolbar or permanent side panel. Long filenames truncate without resizing the controls, chips wrap before they overflow, and the same reading order is preserved on narrow screens. Use a restrained border and narrow focus ring at rest; persistent wide shadows, decorative cards, and capability labels do not belong in this surface.

Conversation history and AI artifacts are two forms of progressive disclosure that share one auxiliary panel slot. The chat toolbar shows the current conversation title plus compact new-conversation, history, and artifact controls. On wide screens the auxiliary panel sits beside the chat and shows either history or artifacts, never both; artifacts remain the default when entering Veges AI. On narrow screens, chat, history, and artifacts replace one another at full width and each auxiliary view provides a clear return path. History is a compact navigation list grouped by recency with loading, empty, error, rename, delete, and pagination states; it is not a visible AI capability mode.

The message timeline preserves user input for processing, failed, and stopped turns. Ordinary replies and conversation analysis reveal text as it arrives; structured summary and todo work shows concise named phases without exposing partial JSON. Processing, interrupted-connection reconciliation, failure, and stopped feedback live inside the related assistant message, with one icon, short title, and optional detail. Do not duplicate a turn error below the timeline or apply failed styling to the user's source message. Failed or stopped turns expose a concise retry action, an in-flight turn exposes stop, and saved summary or todo-proposal outcomes can reopen their independent artifact/review surface. Deleting history uses explicit confirmation and states that saved documents and created todos remain. The composer starts at two text rows and grows only when content or context requires it. Do not add permanent capability tabs, a fixed project selector, a model badge, nested cards, or a second Veges AI heading inside the canvas.

### Project Package Workbench

Treat package market, delivery event, operation, and related-todo controls as one dense tool surface. Keep object keys and versions in mono text, preserve request and error state, and use dialogs only for edits that cannot fit safely inline.

## Do's and Don'ts

### Do:

- **Do** keep primary controls between 32px and 34px high and use 6px to 8px radii.
- **Do** reserve Workbench Green for actions, selected state, and operational signals.
- **Do** expose loading, empty, failure, disabled, and partial-save states where data is remote.
- **Do** use icons with concise labels for unfamiliar or destructive actions.
- **Do** preserve both light and dark token roles when adding a new component.

### Don't:

- **Don't** turn authenticated product screens into a marketing landing page.
- **Don't** use a decorative grid of oversized cards that slows scanning.
- **Don't** mimic a traditional enterprise project-management suite centered on sprints, Gantt charts, or process ceremony.
- **Don't** build a noisy social feed where collaboration activity displaces project context.
- **Don't** use purple gradients, glass effects, or motion used only as decoration.
- **Don't** nest cards, invent a new form-control vocabulary, or use pill shapes for ordinary buttons and fields.
