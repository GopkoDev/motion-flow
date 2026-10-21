# Socratic loop: how to ask the designer questions

Used by `intake`, `new-flow`, `learn-studio` and `refine-flow`. The goal is to learn what is missing with as few questions as possible, and to leave a written record of what was assumed.

## Rules

1. **One question at a time.** Wait for the answer before the next one.
2. **Offer choices.** Use `AskUserQuestion` with 2-4 options whenever the answer is a choice; add free text only when it must be free (names, numbers, paths). Put your recommended option first.
3. **Propose a sensible default** and say why, so the designer can answer with one click.
4. **Do not ask what you can find out.** Read the task, the project dump, `.motion/`, the studio rules and the flow files first. Ask only about what stays unknown after that.
5. **Keep a list of assumptions.** Every time you decide something without asking, or the designer accepts a default, add it to a list. At the end write the whole list into the artifact (`## Known facts and assumptions`), so the next step and the designer can see it.
6. **Stop on a contradiction.** If the designer's request conflicts with a studio rule (naming, protected comps, delivery format), say which rule, show both sides, and ask which is right. Never pick silently. If the rule should change, that is a separate request.
7. **Do not interrogate.** If three questions in a row got "I don't know", stop asking about that topic: write it as an open question in the artifact and move on.
8. **Do not repeat** a question that was already answered in this conversation or in a file.

## Two depths

- **Short (default):** only the questions without which the next step cannot start. Everything else becomes an assumption in the list.
- **Detailed:** when the designer asks for it, or the task is new for the studio, or a flow is being created: also confirm assumptions, edge cases and examples one by one.

Pick the depth from the designer's wording (a request for a quick or short run means short; "in detail" or "ask me more" means detailed; the designer may say it in any language, Ukrainian included). If unclear, start short and offer to go deeper.

## Style of a question

- Plain words in the designer's language (Ukrainian), no jargon: say "composition" and "layer" (in Ukrainian), not "comp tree".
- Say what the answer will change (for example: "this decides whether the video is saved in two formats").
- Show the thing you are asking about (a layer name, a file path) instead of describing it.

## Closing

End the interview with a short summary: the decisions, the assumptions list, the open questions. Ask only "Is this right?" (in Ukrainian) before writing the artifact, never a long list of confirmations.
