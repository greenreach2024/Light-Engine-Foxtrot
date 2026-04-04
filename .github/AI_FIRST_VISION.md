# AI-First Vision -- Future Goals

> This document outlines the long-term direction for the Light Engine platform.
> Items listed here are **future goals** -- not current implementation tasks.
> They guide design decisions but should not be treated as active work items.

---

## Vision Statement

The Light Engine platform is moving toward an AI-agent-driven experience where
E.V.I.E. becomes the primary interface for farm operations. Data remains fully
accessible, but the UI simplifies over time. Dedicated single-purpose pages
give way to intelligent summaries, PDFs, and conversational interactions.

## Core Principles

1. **Data stays, pages consolidate.** Every data point the system collects
   today remains available. The change is in how users access it -- through
   E.V.I.E. summaries, generated PDFs, and dynamic views instead of dozens
   of standalone pages.

2. **E.V.I.E. as primary interface.** A single large E.V.I.E. page that can
   access all farm information and display it, summarize it, generate PDFs,
   and present it in a dynamic, context-aware layout. Users ask for what they
   need rather than navigating to it.

3. **Fewer pages, smarter pages.** The application moves from many
   specialized pages to a small number of intelligent pages that adapt to the
   user's role, intent, and current needs.

4. **Backend stability.** The backend does not need to change. APIs, data
   storage, and business logic remain as-is. The UI layer updates to keep the
   platform clean and focused.

5. **User intent drives the experience.** Not every user needs full farm
   management. Some use the system for accounting and online sales only.
   The platform should detect and respect this from the start.

## Planned Milestones (No Timeline)

### Phase 1 -- Consolidation (Current)
- Move summary data (farm value, alerts, tasks) to the main dashboard
- Put the E.V.I.E. status bar on every page so context is always visible
- Collapse or remove pages that duplicate data available elsewhere
- Make the setup wizard responsive to user intent (full farm vs sales-only)

### Phase 2 -- E.V.I.E. as Primary
- Expand the E.V.I.E. Core page into a full-featured interaction surface
- E.V.I.E. can render tables, charts, and summaries inline
- E.V.I.E. can generate and serve PDF reports on demand
- E.V.I.E. can navigate the user to any part of the system via conversation

### Phase 3 -- Page Reduction
- Remove dedicated pages whose data is fully served by E.V.I.E.
- Crop Value, Financial Summary, and similar read-only views become
  E.V.I.E. responses or generated PDFs
- The sidebar shortens to essential pages only

### Phase 4 -- Agent-Driven Operations
- E.V.I.E. proactively schedules tasks, generates reports, and sends alerts
- The platform runs largely on autopilot with human oversight
- Users interact primarily through conversation and notification responses

## User Personas

### Full Farm Operator
Uses everything -- sensors, environment monitoring, inventory, scheduling,
sales, wholesale, accounting. Wants a dashboard with live data and quick
access to E.V.I.E. for deeper analysis.

### Sales and Accounting User
Uses the farm sales terminal, wholesale portal, invoicing, and financial
reports. Does not need sensors, grow spaces, or environment monitoring.
Setup wizard skips farm-specific steps.

### Explorer
Wants to look around before committing. Setup wizard exits immediately,
letting them browse with sample/demo data.

---

*Last updated: 2026-04-04*
