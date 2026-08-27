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
