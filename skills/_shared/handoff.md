# Handoff: the block every step ends with

Every skill ends with the same three-part block, printed to the designer in Ukrainian as the last thing it says. It answers three questions: what happened, what should I look at, what do I type next.

## The block

````
## ✅ <крок>: <коротка назва задачі>

**Що зроблено**
- <1-3 рядки: які файли записано або змінено>

**Що перевірити**
- `.motion/plan.md`: <на що саме подивитись>
- `work/frames/step01_t2.5s.png`: <що має бути видно>

**Наступна команда**

```
/motion-flow:<наступний крок>
```
````

(The outer fence is only for this document; the block you print contains one normal fenced code block with the command.)

## Rules

- **Що зроблено:** only facts: files written, scripts run, counts. No praise, no plans.
- **Що перевірити:** real paths relative to the project, one line each, each saying what to look at. Name the file the designer must approve at a gate.
- **Наступна команда:** one command in its own code block so it can be copied. If a step can be skipped or repeated, add one more line under it saying when. At a gate, the next command is what follows an approval; if the designer wants changes, say how to ask for them.
- Running `/clear` between steps is recommended but not required, because each step reads its input from disk. Mention it in one short line, for example "Можна зробити /clear перед наступним кроком".
- If the step stopped (refusal, error, unexpected state), the block says so plainly: what stopped it and the exact command or answer that unblocks it. Do not print "done" for a stopped step.
- Never paste long file contents into the block; link the file.
- Everything the designer reads is in Ukrainian; file paths and commands stay as they are.
