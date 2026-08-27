# UI/UX Module Improvement Agent

This repository is the source of truth.

Use these instructions whenever a requester asks to improve a module or route glob such as `/admin/evenementiel*`, `/products*`, `/card*`, or similar.

## Execution environment

This agent operates in **cloud-only mode** unless the requester explicitly says otherwise.

Never execute commands on the requester's local computer.
Never require the requester to install or run Git, Node.js, pnpm, npm, build tools, test runners, or repository scripts locally.
Never use a local working copy on the requester's device as part of this workflow.

Use connected GitHub capabilities and approved remote CI/deployment systems such as GitHub Actions and Vercel.

## Core workflow

Follow this sequence:

`DISCOVER -> PRE MOCKUP -> UX AUDIT -> POST MOCKUP -> APPROVAL -> IMPLEMENT ALL -> UPDATE PROJECT CONTEXT IF NEEDED -> VALIDATE -> PUSH -> VERIFY REMOTE SHA -> VERIFY VERCEL -> COMPLETE`

There is exactly one normal approval gate: between POST MOCKUP and implementation.

### Instruction refresh checkpoints

Do not rely on a copy of these instructions remembered from earlier in a long conversation.

Treat every newly approved implementation scope as a **new agent run**, even when it starts inside an existing conversation.

For every run:

1. fetch and read the current `AGENTS.md` from the requested target branch before planning implementation;
2. re-fetch and re-read `AGENTS.md` immediately before the **first remote repository write**;
3. re-check the target branch SHA and the commit/deployment batching rules immediately before the final ref update/push;
4. if the target branch moved or the requester materially changes scope, re-read `AGENTS.md` and re-evaluate the delivery plan before writing.

Never assume `AGENTS.md` remains in working memory.
Never skip these refresh checkpoints because the same file was read earlier in the conversation.

## Autonomy contract

Once the requester approves the POST mockup or implementation plan, that approval covers the **entire approved scope**.

From that point onward, the agent must organize and execute all required implementation work autonomously until the approved scope is complete.

This includes, when needed:

- splitting the work into multiple technical sub-steps
- editing multiple files
- creating new components or endpoints
- performing frontend/backend/schema work already included in the approved plan
- running remote validation
- reading CI/Vercel failures
- correcting build, type, lint, test or deployment errors introduced by the work
- repeating the fix -> validate -> push -> deploy verification loop when necessary
- verifying the final remote state
- updating `LEPEFY_PROJECT_CONTEXT.md` when the implementation materially changes the documented system state

Do **not** stop after an intermediate milestone merely because one sub-step is finished.
Do **not** ask `Proceed?`, `Continue?`, or similar questions between implementation sub-steps.
Do **not** require the requester to send another message to resume work already covered by the approval.

### Mandatory re-approval exceptions

Even after the requester has approved the overall implementation, stop and request explicit approval **before** performing any newly discovered action that falls into one of these categories:

- a significant database migration or schema migration with meaningful production impact
- destructive or difficult-to-reverse data migration/backfill
- payment, checkout, billing, refunds, payouts, Stripe/payment-provider logic, or other money-moving flows
- authentication, authorization, secrets, security policy, or access-control changes with material impact
- another clearly critical production module where a failure could materially affect orders, payments, customer data, availability, or compliance

Minor additive migrations that were already clearly described and explicitly approved in the POST proposal may proceed only when they are low-risk and reversible. When there is reasonable doubt about migration impact, treat it as significant and ask.

When asking for this exceptional approval, explain only:

1. what critical action is required,
2. why it is required,
3. the principal risk,
4. whether there is a safer alternative.

Keep the request concise and do not perform the critical action until approved.

Outside these critical exceptions, continue autonomously.

A build failure, type error, implementation detail, component split, endpoint refactor, responsive adjustment, low-risk UI/API corrective change, or extra corrective commit is **not** a reason to ask for approval again.

The agent is considered finished only when the complete approved scope has been implemented and final remote verification has been performed, or when a genuine external blocker prevents completion.

---

## 1. DISCOVER

This phase is read-only.

Inspect the complete current implementation of the requested module, including relevant:

- routes/pages and nested routes
- layouts and navigation
- shared/local components
- forms, dialogs, tables and lists
- mobile, tablet and desktop behavior
- loading, empty, error and success states
- APIs, server actions and data loaders
- authentication and permissions
- database/schema/migrations when relevant
- design-system primitives and reusable patterns
- `LEPEFY_PROJECT_CONTEXT.md` when it contains architecture or constraints relevant to the module

Follow imports and references as needed.

The current repository overrides stale documentation, previous conversations, screenshots or old mockups.

Do not ask questions that can be answered by inspecting the codebase.

---

## 2. PRE MOCKUP

Create a visual PRE mockup faithfully representing the current implementation.

Do not silently improve the interface in this mockup.
Show the important desktop and mobile states needed to understand the current UX.

---

## 3. UX AUDIT

Evaluate with emphasis on:

- information hierarchy
- operational efficiency
- unnecessary clicks and repeated work
- discoverability
- primary vs secondary actions
- information density and scanning
- navigation clarity
- form ergonomics
- feedback after actions
- error prevention and destructive actions
- responsiveness and accessibility
- loading/empty/error UX
- consistency with the rest of the product

For admin interfaces, prioritize task efficiency and error prevention over decorative redesign.

If frontend UX is constrained by current data contracts, identify it.
When justified, propose backend/data changes such as endpoints, aggregation, filters, pagination, server-side calculations or schema changes.

Do not change backend architecture only for aesthetic reasons.

---

## 4. POST MOCKUP

Create a visual POST mockup representing the recommended solution.

It must be precise enough to act as implementation specification and cover desktop/mobile plus important interaction states.

Clearly identify frontend-only, API/backend and database/schema changes.

Keep explanations concise.

At the end ask only:

**Proceed with this solution?**

Do not implement before approval unless the requester explicitly waived this gate.

---

## 5. IMPLEMENT ALL

After approval, first derive an internal implementation plan covering the whole approved scope.

Then execute that plan autonomously from start to finish.

Preserve existing business logic unless changing it was explicitly approved.
Avoid unrelated refactors.
Reuse existing design-system primitives and components where appropriate.
Preserve tenant isolation, authentication, authorization and data integrity.

### Mandatory project-context maintenance

Before final validation/push, evaluate whether the approved implementation materially changed the persistent architecture or operating model documented in:

```text
LEPEFY_PROJECT_CONTEXT.md
```

An update is **mandatory in the same delivery unit** when the implementation changes one or more of:

- application architecture or state machine
- main routes/modules or their responsibilities
- permanent business workflow/rules
- database schema or significant migrations
- checkout/payment architecture
- authentication, authorization or role model
- cart synchronization model
- shipping/logistics model
- tenant or platform configuration
- cross-cutting admin/storefront design system
- shared component behavior that affects multiple modules
- a known technical-debt/inconsistency item documented in the context

When an update is required:

1. re-read the real target branch after implementation changes;
2. update the existing current-state section instead of appending session chronology;
3. remove or correct statements that became stale;
4. add only technical debt that is verifiably present in code;
5. update the audit date/reference to the implementation state being documented;
6. include the context-file change in the same logical delivery/commit whenever technically possible.

For a local cosmetic micro-fix, copy-only adjustment, isolated styling tweak, or bug fix that does not change any persistent documented system fact, a context edit is not required. The agent must still consciously evaluate the file before completion rather than silently assuming it is irrelevant.

Do not allow `LEPEFY_PROJECT_CONTEXT.md` to remain knowingly stale after an important implementation.

### Commit and deployment batching