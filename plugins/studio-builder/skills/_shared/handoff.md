# Handoff: the block every studio-builder skill ends with

Every skill ends with the same block, as the last thing it says. It answers: what happened, what should I look at, what do I type next. The block is written in English here; **print it to the designer in Ukrainian** (translate the headings and the text; file paths and commands stay as they are).

````
## ✅ <skill>: <short title>

**What was done**
- <1-3 lines: which files were written or changed, how many examples were counted>
- check: <N/N pass, or what failed>

**What to check**
- `rules/naming.md`: <what exactly to look at>

**Next**

```
/studio-builder:<next skill>
```
````

(The outer fence is only for this document; the block you print contains one normal fenced code block with the command.)

## Rules

- **What was done:** only facts: files written, examples counted, checks run. No praise, no plans.
- **What to check:** real paths relative to the folder, one line each, each saying what to look at. Name the files a person must confirm (rules start as `draft`).
- **Next:** one command in its own code block. If a step can be skipped or repeated, say when. After `learn-studio` the usual next is `new-flow`; after `new-flow` it is `publish-flow` or `export-claude`.
- If the skill stopped (a refusal, an error, a question left open), the block says so plainly: what stopped it and the exact answer or command that continues it. Do not print "done" for a stopped skill.
- Never paste long file contents into the block; link the file.
