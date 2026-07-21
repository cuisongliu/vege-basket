# Product

## Register

product

## Users

Veges serves people who run several projects at once and need to recover context quickly. The primary user owns projects, journals decisions, organizes drafts and todos, and reviews delivery risk. Project members use the same workspace to handle assigned todos, mentions, and package delivery events without needing a separate issue tracker.

## Product Purpose

Veges is a daily project cockpit. It keeps project context, journals, drafts, todos, summaries, collaboration signals, and package delivery timelines in one searchable workspace. Success means a user can open a project, understand what changed, see what needs action, and record the next decision without reconstructing context from several tools.

Veges AI is a private, recoverable work conversation rather than a stateless prompt box.
Users can resume personal history across refreshes, start a project-bound conversation with
`@项目`, or work without project facts in a general conversation. Summaries, Markdown todo
proposals, and conversation analysis stay in the same timeline; AI-created todos still require
review and confirmation, while generated summaries are saved as independent documents.
An explicit current-day or current-week workspace review can aggregate authorized projects,
the user's own journals, todo activity, actionable backlog, and current risks directly from the
server. Ordinary chat remains unscoped and never receives workspace facts implicitly.

## Brand Personality

Calm, focused, dependable. Copy should be direct and operational. The interface should feel ready for repeated daily work, with enough density for scanning and enough restraint that status, ownership, and errors remain obvious.

## Anti-references

- A marketing landing page inside the authenticated product.
- A decorative grid of oversized cards that slows scanning.
- A traditional enterprise project-management suite centered on sprints, Gantt charts, or process ceremony.
- A noisy social feed where collaboration activity displaces project context.
- Purple gradients, glass effects, or motion used only as decoration.

## Design Principles

1. **Context before ceremony.** Put journals, decisions, todos, and delivery state close to the project they describe.
2. **Make ownership and state explicit.** Assignment, completion, delivery status, and failures must be visible and recoverable.
3. **Keep the cockpit scannable.** Prefer compact navigation, predictable controls, and progressive disclosure over presentation-heavy layouts.
4. **AI assists; users decide.** AI may summarize and organize, but users retain control of records, destinations, and final content.
5. **Protect the source of truth.** Sensitive content stays encrypted at rest, external URLs and object keys are constrained, and multi-step writes are atomic where partial state would mislead users.

## Accessibility & Inclusion

Use semantic controls, visible keyboard focus, readable status text, and color-independent labels. Preserve usable light and dark themes. New work should target WCAG 2.1 AA contrast and provide reduced-motion behavior for any non-essential animation. The current repository does not claim formal accessibility certification.
