# PRD: Personal Project Dashboard

> [!NOTE]
> 本文是项目早期的产品与设计历史记录，不再代表当前实现边界。当前事实请以 [README](../README.md)、[ROADMAP](../ROADMAP.md) 和仓库代码为准。

## Problem Statement

As a product manager managing multiple concurrent projects, I need a personal system that helps me keep up with each project's evolving context. Existing project management tools are usually designed around team collaboration, tasks, sprint workflows, issue tracking, or delivery process control. They are too heavy for the personal problem I am trying to solve.

The real problem is that every project has its own "basket" of scattered information: daily progress, new decisions, unresolved problems, solution ideas, relevant conversations, next steps, and changing priorities. When several projects move at the same time, it becomes difficult to quickly reload the context of each project and understand what happened today, what changed this week, what is blocked, and what needs attention next.

This product should help me clear and organize the different project baskets in my mind. It should work like a daily project cockpit: when I open it, I can quickly see the state of all active projects, capture new information into an inbox, write or review each project's daily journal, manage cross-project todos, search historical context, and use AI to generate weekly and monthly summaries.

## Solution

Build a personal Web App for project context management. The product will be single-user oriented in its first phase, but it still needs a login system and a server-side database so the data can be securely stored and synced through the web application.

The main interface is a card-based project list. Each project card shows the project name, status, and latest update time. Clicking a card opens the project detail page, where information is organized like a daily notebook. Each project has one journal entry per day, and a daily entry can combine manually written notes, content archived from the daily inbox, and content imported from external sources.

The app also includes a Today Inbox. This is a quick capture area for unstructured project information before it is assigned to a specific project. In the first version, users manually archive inbox items into projects, while AI can optionally suggest the target project. Feishu bot integration should be reserved from the beginning: forwarded group chat records can later be synced into the Today Inbox through the bot interface. In the first version, Feishu-originated content only needs to enter the inbox and does not need to be automatically attached to a project.

AI capabilities focus on summarization and organization assistance. Users can manually generate weekly and monthly summaries for each project. These summaries are saved as independent summary documents, not embedded directly into daily journal entries. Summaries should cover progress, key decisions, unresolved issues, risks, next-step suggestions, and project state changes.

The app also provides a cross-project dashboard for daily work. The first version should emphasize three areas: today's updates, all project todos, and recent risks or blockers. Todo management should remain lightweight but useful: project-level todos need due dates, priorities, completion state, and a cross-project "today's todos" view.

Search is a core capability, not a secondary enhancement. Users should be able to search and filter across projects, dates, project status, tags, and todo state. Markdown export and import should be supported. Export should work for a single project or multiple projects in batch. Import can accept Markdown as unstructured content; the app does not need to preserve or parse detailed structures during import in the first version, because future AI features can help organize imported content.

## User Stories

1. As a personal product manager, I want to log in to my own workspace, so that my project information is private and persistent.
2. As a personal product manager, I want to see all my projects as cards, so that I can quickly understand what projects are currently in my mental workspace.
3. As a personal product manager, I want each project card to show the project name, so that I can immediately identify the project.
4. As a personal product manager, I want each project card to show the project status, so that I can distinguish active, paused, completed, and archived projects.
5. As a personal product manager, I want each project card to show the latest update time, so that I know which project has stale context.
6. As a personal product manager, I want to create a new project, so that I can start tracking a new project basket.
7. As a personal product manager, I want to edit a project's name, status, and tags, so that the project list stays aligned with reality.
8. As a personal product manager, I want to archive projects, so that inactive projects do not clutter my daily cockpit.
9. As a personal product manager, I want to reopen an archived project, so that old context can become active again when needed.
10. As a personal product manager, I want to click a project card and open its detail page, so that I can enter the project's dedicated context space.
11. As a personal product manager, I want each project to have a daily journal, so that project information is organized by date.
12. As a personal product manager, I want each project to allow only one journal entry per day, so that daily context remains consolidated instead of fragmented.
13. As a personal product manager, I want to write free-form daily notes, so that I can record progress, problems, ideas, and decisions without rigid structure.
14. As a personal product manager, I want to edit today's journal entry throughout the day, so that the entry can evolve as new information appears.
15. As a personal product manager, I want to review past journal entries by date, so that I can reconstruct how a project evolved.
16. As a personal product manager, I want manually written notes and archived inbox content to coexist in the same daily entry, so that the day's project context is complete.
17. As a personal product manager, I want a Today Inbox, so that I can quickly capture information before deciding where it belongs.
18. As a personal product manager, I want to create inbox items quickly, so that I can unload project thoughts without interrupting my flow.
19. As a personal product manager, I want inbox items to support unstructured text, so that I can paste meeting notes, chat excerpts, rough thoughts, and solution ideas.
20. As a personal product manager, I want to manually archive an inbox item into a project, so that the captured information becomes part of the correct project context.
21. As a personal product manager, I want to choose which date an inbox item should be archived to, so that delayed organization still lands in the correct daily journal.
22. As a personal product manager, I want the system to append archived inbox content into the target project's daily journal, so that I do not need to copy and paste manually.
23. As a personal product manager, I want archived inbox items to be marked as processed, so that my inbox represents unresolved capture items.
24. As a personal product manager, I want AI to suggest which project an inbox item might belong to, so that archiving becomes faster while I still stay in control.
25. As a personal product manager, I want Feishu bot integration to be reserved, so that future forwarded group messages can enter the product automatically.
26. As a personal product manager, I want forwarded Feishu content to enter the Today Inbox in the first version, so that external project signals are captured without requiring automatic classification.
27. As a personal product manager, I want each project to have lightweight todos, so that I can track next actions without using a full task management system.
28. As a personal product manager, I want todos to have completion state, so that I know what has already been handled.
29. As a personal product manager, I want todos to have due dates, so that time-sensitive follow-ups are visible.
30. As a personal product manager, I want todos to have priorities, so that I can decide what deserves attention first.
31. As a personal product manager, I want to see todos inside a project, so that each project's next actions are visible in context.
32. As a personal product manager, I want a cross-project today's todos view, so that I can plan my day across all project baskets.
33. As a personal product manager, I want to filter todos by status, due date, priority, and project, so that I can focus on the right set of actions.
34. As a personal product manager, I want a cross-project dashboard, so that I can see my entire project landscape when I start work.
35. As a personal product manager, I want the dashboard to show today's updates, so that I know what changed across projects today.
36. As a personal product manager, I want the dashboard to show all project todos, so that action items do not disappear inside individual projects.
37. As a personal product manager, I want the dashboard to show recent risks or blockers, so that I can quickly notice which projects need intervention.
38. As a personal product manager, I want to search across all project journals, so that I can find old context by keyword.
39. As a personal product manager, I want to filter search results by project, so that I can narrow results to a specific project basket.
40. As a personal product manager, I want to filter search results by date range, so that I can locate information from a specific period.
41. As a personal product manager, I want to filter search results by project status, so that active and archived projects can be searched differently.
42. As a personal product manager, I want to filter search results by tag, so that related project information can be grouped across projects.
43. As a personal product manager, I want to filter search results by todo state, so that I can find open or completed action items.
44. As a personal product manager, I want search results to include journal entries, inbox items, todos, and summary documents, so that search feels complete.
45. As a personal product manager, I want to manually generate a weekly project summary, so that I can quickly understand what happened during the week.
46. As a personal product manager, I want to manually generate a monthly project summary, so that I can review broader progress and changes.
47. As a personal product manager, I want AI summaries to include progress, so that I can see what has moved forward.
48. As a personal product manager, I want AI summaries to include key decisions, so that important choices are easy to recover later.
49. As a personal product manager, I want AI summaries to include unresolved issues, so that open loops are not forgotten.
50. As a personal product manager, I want AI summaries to include risks, so that potential problems are surfaced early.
51. As a personal product manager, I want AI summaries to include next-step suggestions, so that I can move from review to action.
52. As a personal product manager, I want AI summaries to include project status changes, so that the project trajectory is visible.
53. As a personal product manager, I want generated summaries to be saved as independent documents, so that summaries have their own lifecycle and can be reviewed separately.
54. As a personal product manager, I want to edit AI-generated summaries after creation, so that the final record reflects my judgment.
55. As a personal product manager, I want to regenerate a summary when source content changes, so that the summary can stay current.
56. As a personal product manager, I want AI model credentials to be configurable, so that the app can use the model provider whose API key I supply.
57. As a personal product manager, I want AI provider details to be abstracted behind an internal interface, so that model providers can change later without redesigning product behavior.
58. As a personal product manager, I want to export a single project to Markdown, so that I can back up or share that project's context.
59. As a personal product manager, I want to export multiple projects to Markdown in batch, so that I can create broader backups.
60. As a personal product manager, I want exported Markdown to include project metadata, daily journals, todos, and summaries, so that the exported file is useful outside the app.
61. As a personal product manager, I want to import Markdown as unstructured source material, so that existing notes can enter the system without requiring a strict format.
62. As a personal product manager, I want imported Markdown to enter an import review or inbox flow, so that I can decide how to organize it later.
63. As a personal product manager, I want the app to record created and updated timestamps, so that recency-based views are reliable.
64. As a personal product manager, I want project tags, so that I can group and filter projects flexibly.
65. As a personal product manager, I want a clean web interface optimized for daily use, so that opening the app feels like entering a cockpit rather than a documentation archive.
66. As a personal product manager, I want the first version to avoid team collaboration features, so that the product stays focused on my personal workflow.
67. As a personal product manager, I want the first version to avoid complex sprint or issue workflows, so that it does not become another traditional project management system.

## Implementation Decisions

- Product shape: build a Web App focused on personal project context management.
- User model: first phase is personal-use only, but a login system is required.
- Storage model: use a server-side database. The database connection string and related credentials will be provided during implementation.
- Main navigation: the product should open into a daily project cockpit rather than a marketing or landing page.
- Project list: show card-based project entries with project name, status, and latest update time.
- Project statuses: support `active`, `paused`, `completed`, and `archived`.
- Project tags: include tags from the beginning because search and filtering depend on them.
- Project detail: organize project information around a daily journal.
- Journal rule: each project has one journal entry per calendar day.
- Journal structure: first version supports free-form content rather than required structured fields.
- Content merging: one daily journal entry can combine manually typed content, inbox-archived content, imported content, and future external-source content.
- Today Inbox: provide a capture-first inbox for unassigned, unstructured information.
- Inbox archiving: first version prioritizes manual archiving from inbox to project and target date.
- AI inbox assistance: AI may suggest a target project, but the user confirms the final archive action.
- Feishu integration: reserve an integration interface for a Feishu bot.
- Feishu first-phase behavior: forwarded Feishu messages enter Today Inbox only; automatic project classification is out of scope for first-phase requirements.
- Todo model: todos are lightweight action items associated with projects.
- Todo fields: support title/content, project, due date, priority, completion state, created time, and updated time.
- Cross-project todo view: include a today's todos view across all projects.
- Dashboard: first version should include today's updates, all project todos, and recent risks or blockers.
- Risk/blocker source: risks and blockers can initially come from manual journal/todo content and AI summary extraction; exact extraction rules can be refined during implementation.
- Search scope: search should cover projects, daily journals, inbox items, todos, and summary documents.
- Search filters: support project, date range, project status, tags, and todo state.
- AI summaries: support manual generation of weekly and monthly project summaries.
- Summary content: include progress, key decisions, unresolved issues, risks, next-step suggestions, and project status changes.
- Summary storage: save AI summaries as independent summary documents.
- Summary editing: allow users to edit generated summaries after creation.
- AI provider design: keep AI provider configuration abstract so implementation can accept API keys supplied later.
- Markdown export: support single-project export and batch project export.
- Markdown export content: include project metadata, daily journals, todos, and summaries.
- Markdown import: accept Markdown as unstructured imported content; first version does not need to preserve structured project/date/todo mappings from imported files.
- Import destination: imported Markdown can enter an import review flow or Today Inbox for later organization.
- Permissions: first version does not require team roles, shared projects, comments, or collaboration permissions.
- Auditability: core records should track created and updated timestamps.
- Time handling: journal dates, due dates, week boundaries, and month boundaries should be handled explicitly and consistently for the user's configured timezone.

## Suggested Modules

- Authentication module: login, session management, and user-scoped data access.
- Project module: project CRUD, status management, tags, archive/reopen behavior, and latest update tracking.
- Journal module: daily journal creation, editing, date navigation, and content merging from manual and archived sources.
- Inbox module: quick capture, inbox item lifecycle, manual archive workflow, and AI project suggestion hooks.
- Todo module: project todos, due dates, priorities, completion state, and cross-project today view.
- Dashboard module: cockpit view aggregating today's updates, all project todos, and recent risks or blockers.
- Search module: unified full-text search with filters for project, date range, status, tags, and todo state.
- Summary module: weekly/monthly summary generation, storage, editing, regeneration, and source-content selection.
- AI provider module: provider-agnostic interface for summarization and suggestion calls.
- Markdown import/export module: project-level and batch export, unstructured Markdown import, and import review routing.
- Feishu integration module: reserved webhook/bot interface that can write incoming forwarded messages into Today Inbox.

## Testing Decisions

- Tests should focus on externally visible behavior rather than implementation details.
- Authentication tests should verify that user data is isolated and unauthenticated access is rejected.
- Project module tests should verify create, edit, status changes, archive/reopen, tags, and latest update behavior.
- Journal module tests should verify the one-entry-per-project-per-day rule, editing behavior, and content appended from archived inbox items.
- Inbox module tests should verify quick capture, manual archive to project/date, processed state changes, and preservation of original inbox content.
- Todo module tests should verify due dates, priorities, completion state, project association, and cross-project today's todo selection.
- Dashboard tests should verify aggregation of today's updates, todos, and risks/blockers from the correct source data.
- Search tests should verify keyword search and filters for project, date range, project status, tags, and todo state.
- Summary module tests should use mocked AI responses and verify source selection, summary persistence, editing, and regeneration behavior.
- AI provider tests should mock external model APIs and verify that product modules do not depend on a specific provider implementation.
- Markdown export tests should verify that exported content includes project metadata, journals, todos, and summaries.
- Markdown import tests should verify that Markdown can be accepted as unstructured input and routed into the intended review/inbox flow.
- Feishu integration tests should mock incoming webhook payloads and verify that forwarded content creates inbox items without automatic project attachment.
- End-to-end tests should cover the core MVP loop: log in, create project, capture inbox item, archive it into today's project journal, create todo, search content, generate weekly summary, and export Markdown.

## Out of Scope

- Team collaboration.
- Multi-user shared projects.
- Role-based permissions beyond personal login and user-scoped data access.
- Comments, mentions, approvals, and review workflows.
- Sprint planning, issue boards, kanban workflows, Gantt charts, burndown charts, or traditional delivery management.
- Required structured daily journal fields in the first version.
- Automatic Feishu message classification into projects in the first version.
- Fully automatic weekly or monthly summary generation in the first version.
- Automatic parsing of imported Markdown into project/date/todo structures in the first version.
- Mobile app and desktop app clients in the first version.
- Public sharing of project pages or summaries.

## Further Notes

- The product should feel like a daily working cockpit. The default experience should help the user quickly regain context across all active projects and decide what to do next.
- The core product distinction is personal context clarity, not team workflow enforcement.
- The first version should keep capture and review friction low. The user should be able to quickly throw information into Today Inbox, then organize it when ready.
- AI should assist but not take control. Manual confirmation remains important for archiving, summaries, and final records.
- The implementation should leave room for future automation, especially AI-based inbox classification, Feishu bot ingestion, and AI-assisted Markdown import organization.
- Before implementation begins, the user will provide required service credentials such as database connection strings and AI model API keys.
