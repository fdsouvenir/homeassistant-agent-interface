---
name: home-assistant-interface
description: Use when reading, discovering, diagnosing, or controlling Home Assistant through the home_assistant_* tools, especially when a task needs efficient tool selection or honest interpretation of action observations.
---

# Home Assistant Interface

Use Home Assistant as the source of truth for household names, capabilities, state, and authorization. Keep calls compact and act on direct control requests instead of replacing them with status-only answers.

## Choose the smallest useful tool

- Use `home_assistant_execute` directly when the action and target IDs are already known.
- Use `home_assistant_find` when an entity, area, device, action name, or supported action field is unknown. Filter by kind or domain and paginate only when needed; do not rediscover identifiers already established in the conversation.
- Use `home_assistant_brief` for a compact multi-entity snapshot before making several separate reads.
- Use `home_assistant_inspect` for exact entity details or explicitly requested attributes that the normal projection omits.
- Use `home_assistant_presence` for current zones, transitions, and time-by-zone history.
- Use `home_assistant_diagnose` for connectivity and instance-health questions, not as a routine preflight before every action.

## Control loop

1. Reuse canonical IDs and action names already supplied by the user or returned by a prior tool call.
2. If the request is ambiguous, call `home_assistant_find` with a narrow query and relevant kinds. Do not guess between similarly ranked matches.
3. Call `home_assistant_execute` with the discovered `domain.action`, native target object, and only the data needed for the requested outcome.
4. Treat `ok: true` as Home Assistant accepting the action. Treat the observation as separate evidence about visible state.
5. Inspect again only when the returned observation cannot answer the user's question.

## Read results precisely

- `coverage.partial: true` means unavailable discovery sources are unknown, not empty. Use `available_kinds` and `unavailable_kinds` when deciding whether to retry or narrow the request.
- Respect `total`, `returned`, `truncated`, and `next_cursor`; do not describe a bounded page as the entire installation.
- Report unresolved or ambiguous targets instead of silently substituting another entity.
- `observation.outcome: "changed"` means at least one resolved target changed during the settle window.
- `observation.outcome: "no_change_observed"` means Home Assistant accepted the action but no state transition was seen before the deadline. It does not mean the action failed.
- Multi-target polling stops after the first observed target change. Returned snapshots are truthful, but slower targets may still be converging.
- `observation.status: "not_applicable"` is normal for actions without resolvable entity targets. `"unavailable"` means observation failed independently of the accepted action.

## Interface boundaries

- Do not add household identities, entity defaults, action catalogs, or assumed area names.
- Do not invent plugin-side approval, allowlist, or risk rules. Home Assistant determines what the configured token may do.
- Do not dump every entity or attribute by default. Prefer semantic search, bounded summaries, and exact attribute escalation.
- Do not translate structured tool results into CLI-style logs. Preserve the distinctions the result schema provides.
