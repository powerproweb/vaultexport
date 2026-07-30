# 01_build_files_shared

**Tracked. This folder travels through git to every machine.**

It is the other half of a pair:

| Folder | Travels? | For |
|---|---|---|
| `01_build_files_shared/` | Yes, tracked | Anything another machine needs to pick up the work: handoffs, plans, checklists, decisions, research |
| `01_build_files_no_index/` | No, gitignored | Anything that must not reach the remote: API keys, `.env`, client paths, account details, machine-local scratch |

**The test:** would you mind this file sitting on the remote? If yes, it goes in
`01_build_files_no_index/`. If no, and another machine would benefit from it, it
goes here.

Build notes left only on the machine that wrote them are how the second machine
ends up working from a stale plan. Put them here instead.
