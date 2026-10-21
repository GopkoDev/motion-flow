# Handoff: the block every step ends with

Every skill ends with the same three-part block, as the last thing it says. It answers three questions: what happened, what should I look at, what do I type next. The block is written in English here; **print it to the designer in Ukrainian** (translate the headings and the text; file paths and commands stay as they are).

## The block

````
## ✅ <step>: <short task title>

**What was done**
- <1-3 lines: which files were written or changed>
- self-check: <N/N pass, or what failed>

**What to check**
- `.motion/plan.md`: <what exactly to look at>
- `work/frames/step01_t2.5s.png`: <what should be visible>

**Next command**

```
/motion-flow:<next step>
```
````

(The outer fence is only for this document; the block you print contains one normal fenced code block with the command.)

## Rules

- **What was done:** only facts: files written, scripts run, counts. No praise, no plans. For a step that writes an artifact, the last line is the structural self-check result from `mf-gate verify` (`self-check: 7/7 pass`, or what is still failing). It is mandatory even when everything passes.
- **What to check:** real paths relative to the project, one line each, each saying what to look at. Name the file the designer must approve at a gate.
- **Next command:** one command in its own code block so it can be copied. If a step can be skipped or repeated, add one more line under it saying when. At a gate, the next command is what follows an approval; if the designer wants changes, say how to ask for them.
- Running `/clear` between steps is recommended but not required, because each step reads its input from disk. Mention it in one short line.
- If the step stopped (refusal, error, unexpected state), the block says so plainly: what stopped it and the exact command or answer that unblocks it. Do not print "done" for a stopped step.
- Never paste long file contents into the block; link the file.
- Everything the designer reads is in Ukrainian; file paths and commands stay as they are.
