# Motion Flow: специфікація реалізації

Документ для Claude Code. Мета: побудувати набір плагінів, які дають моушн-команді (After Effects) агентний пайплайн для повторюваних задач, з правилами студії окремо і флоу, які дизайнери створюють самі.

## 0. Як користуватись цим документом

1. Прочитай повністю, потім реалізуй за milestones з розділу 12. Кожен milestone має критерії приймання.
2. Позначки **[перевірити]** означають: підтверди в актуальній документації або в коді джерела, не покладайся на цей текст. Описи зовнішніх репо я читав, але код не перевіряв.
3. Перед копіюванням чогось із зовнішніх репо перевір ліцензію і прочитай код. Для SDD (MIT) зберігай згадку автора (Kyrylo Genkov) у `NOTICE`. Де можна, переписуй своїми словами під наш випадок, а не копіюй дослівно.
4. Розробка йде на Mac Air M1 з 8 ГБ, де After Effects не запуститься (офіційні вимоги: 16 ГБ і M1 Pro або новіший). Тому все, що не потребує AE, тестуй локально, а AE-частину на фікстурах (JSON-дампи реальних проєктів). Інтеграційні тести з живим AE робить людина на машині дизайнера.

## 1. Контекст і ухвалені рішення

Користувачі: моушн-дизайнери, After Effects, Google Drive for Desktop, часто без git.

Повний SDD (10+ етапів) для моушну не потрібен: результат оцінюється очима, .aep бінарний і не дифається, а справжній біль команди ще невідомий. Беремо з SDD ідеї, а не весь набір.

Ухвалені рішення:

1. **Скелет із п'яти кроків:** `intake → plan → build → check → deliver`. Gating: `build` не стартує без апрувнутого `plan.md`, `deliver` без апрувнутого `check.md`.
2. **Людина вирішує після `plan` і після `check`.** На інших кроках апрувів немає.
3. **Правила студії окремо від скелета** (плагін `studio-rules`). Скелет читає їх у чітких точках.
4. **Флоу створює дизайнер** через `new-flow` (розповідь + приклад + допит + dry-run). Опублікований флоу перед тим, як потрапити всій команді, проходить рев'ю технічної людини.
5. **Drive: локальний бекенд, тільки читання.** Google Drive for Desktop папка для агента звичайна папка, доступ тільки через скрипт `drive-gate` з allowlist. Команди `put`, delete, move, rename не існують. Результати дизайнер переносить на Drive сама. Бекенд через API додається пізніше, якщо флоу цього вимагатиме.
6. **Три шари:** `motion-flow` (універсальний), `studio-rules` (приватний, правила й флоу студії), проєкт. Каталог плагінів: `motion-marketplace`.
7. **Git** обов'язковий тільки для репо плагінів. У проєкті опційний (локальні коміти текстових артефактів, без push). `.aep`, асети й рендери ніколи не в git.
8. **Залежності** (ffmpeg, whisper, node) оголошуються в `deps.json`, перевіряє скіл `doctor`. Агент нічого не ставить мовчки.
9. **Запобіжники живуть в інструментах і hooks**, а не в тексті скілів: робота на копії, undo-групи, allowlist, deny-правила.
10. **After Effects керуємо JSX-скриптами через `ae-run`, без MCP-серверів.**
11. **Усі скрипти плагіна (`bin/`, `hooks/`, `scripts/`) пишемо на Node.js** (ESM, без зовнішніх залежностей, тести через вбудований `node:test`), мінімальна версія Node 24 (LTS). Python не використовуємо. Файли в `bin/` мають shebang `#!/usr/bin/env node`; на Windows їх викликають як `node bin/<name>`.

## 2. Три репозиторії та структура

> **Зміна (розділ 16, п. 1):** окремого репо `motion-marketplace` немає: каталог (`marketplace.json`) лежить у самому `motion-flow`. Скелет `studio-rules` лежить у `motion-flow/templates/studio-rules/`, студія створює з нього свій репо (`init-rules`). Плагін правил має унікальну назву `<студія>-rules`.

```
motion-marketplace/                  # публічний або приватний, каталог
  .claude-plugin/marketplace.json
  README.md

motion-flow/                         # універсальний плагін
  .claude-plugin/plugin.json
  skills/
    intake/SKILL.md
    plan/SKILL.md
    build/SKILL.md
    check/SKILL.md
    deliver/SKILL.md
    new-flow/SKILL.md
    refine-flow/SKILL.md
    publish-flow/SKILL.md
    init-rules/SKILL.md
    doctor/SKILL.md
    whats-new/SKILL.md               # опційно, M5
    _shared/
      gating.md  handoff.md  socratic-loop.md  safety.md
      artifact-formats.md  ae-scripting.md  drive-access.md
  hooks/hooks.json  hooks/guard.mjs
  bin/drive-gate  bin/aep-version  bin/ae-lint
  bin/ae-run  bin/ae-dump  bin/ae-render-frame
  lib/jsx/                           # dump.jsx, helpers.jsx
  templates/                         # шаблони артефактів і конфігів
  deps.json
  DRIVE.md
  scripts/validate_plugin.mjs
  evals/
  NOTICE  LICENSE  README.md

<studio>-rules/                      # приватний плагін студії
  .claude-plugin/plugin.json
  skills/studio-rules/SKILL.md
  rules/
    naming.md  motion-system.md  protected.md  delivery.md  drive.md
    project-template/  checks/
  flows/                             # затверджені флоу
  CHANGELOG.md  README.md

project-x/                           # проєкт
  .claude/settings.json
  .claude/skills/                    # чернетки флоу цього проєкту
  .motion/
    task.md  plan.md  check.md  deliver.md  overrides.md
    snapshots/  build.log.jsonl  state.json
  jsx/
  work/                              # gitignored: копії .aep, кадри, експорти
```

## 3. Артефакти і gating

| Крок | Вимагає | Створює | Апрув людини |
|---|---|---|---|
| intake | нічого | `.motion/task.md` | ні |
| plan | `task.md` | `.motion/plan.md`, `snapshots/project-map-*.json` | **так** (`approved: true` + `plan_sha256`) |
| build | `plan.md` з `approved: true`, хеш збігається | `jsx/NN-*.jsx`, нова копія .aep у `work/`, `build.log.jsonl` | ні |
| check | `build.log.jsonl` без помилок | `.motion/check.md`, кадри в `work/frames/` | **так** (`approved: true`) |
| deliver | `check.md` з `approved: true` | файли в `work/out/`, `.motion/deliver.md` | ні |

Правила gating (`_shared/gating.md`):
- Відсутній або неапрувнутий файл: крок відмовляється, називає крок, який його створює, і зупиняється. Це не помилка, а підказка.
- Якщо після апруву `plan.md` змінили, хеш не збігається: `build` відмовляється й просить повторний апрув.
- Апрув фіксується тільки після явної відповіді людини (використовуй `AskUserQuestion`), ніколи самим агентом.

## 4. motion-flow: файл за файлом

Формат опису: **Призначення**, **Вміст**, **Беремо з**.

### 4.1 `.claude-plugin/plugin.json`
- **Призначення:** маніфест плагіна.
- **Вміст:** `name: motion-flow`, `version: 0.1.0`, `description`, `author`, `license`. Інкрементуй версію при кожному релізі.
- **Беремо з:** форма маніфесту з `genkovich/sdd/.claude-plugin/plugin.json`. Codex/Cursor-маніфести (`.codex-plugin`, `.cursor-plugin`, `install.sh`) поки не потрібні. Точну схему **[перевірити]**: https://docs.claude.com/en/docs/claude-code/plugins-reference

### 4.2 `skills/_shared/gating.md`
- **Призначення:** єдине джерело правил відмови кроків.
- **Вміст:** таблиця з розділу 3, шаблон тексту відмови (що відсутнє, який крок запустити), правило хеша плану, правило «апрув тільки від людини».
- **Беремо з:** ідея hard-refuse і таблиця «When a stage refuses» з `genkovich/sdd` README, плюс реалізація в кожному `SKILL.md`. Спрощено до двох воріт.

### 4.3 `skills/_shared/handoff.md`
- **Призначення:** однаковий блок наприкінці кожного кроку.
- **Вміст:** три частини: *Що зроблено* (файли, які записано), *Що перевірити* (посилання на файли), *Наступна команда* (у код-блоці, `/motion-flow:plan` тощо). `/clear` між кроками рекомендований, але необов'язковий, бо кроки читають вхід із диска.
- **Беремо з:** `genkovich/sdd/skills/_shared/handoff.md` (формат блоку є в README). Прибери вимогу обов'язкового `/clear`.

### 4.4 `skills/_shared/socratic-loop.md`
- **Призначення:** правила допиту для `intake`, `new-flow`, `init-rules`, `refine-flow`.
- **Вміст:** одне питання за раз, варіанти відповідей де можливо, пропонувати розумне значення за замовчуванням, фіксувати всі припущення списком наприкінці, не питати того, що можна дізнатись із файлів або дампа, зупинятись на суперечності з `studio-rules` і питати, що правильне.
- **Беремо з:** `genkovich/sdd/skills/_shared/` (socratic-loop, ask-style, interview-depth) **[перевірити точні імена файлів]**. Залиш два режими (стисло/докладно) замість easy/medium/hard.

### 4.5 `skills/_shared/safety.md`
- **Призначення:** інваріанти, на які посилаються всі скіли (повний список у розділі 9).
- **Вміст:** робота лише на копії, undo-група на кожну зміну, жодних прямих звернень до Drive-папки, нічого не видаляти, нічого не ставити без команди людини, зупинка й питання при будь-якій несподіванці.
- **Беремо з:** пишемо з нуля. Орієнтир за духом: `permissions` і `stop_on_red` у конфігу SDD (`.claude/sdd.local.md`).

### 4.6 `skills/_shared/artifact-formats.md`
- **Призначення:** формати `task.md`, `plan.md`, `check.md`, `deliver.md`, `overrides.md`, `state.json`.
- **Вміст:** frontmatter і обов'язкові секції (див. розділ 8). Один файл, на нього посилаються всі кроки.
- **Беремо з:** принцип «кожен етап пише файл, який читає наступний» і шаблони `skills/<n>/templates/` з SDD.

### 4.7 `skills/_shared/ae-scripting.md`
- **Призначення:** правила написання й запуску JSX для всіх скілів, що чіпають AE.
- **Вміст:** ідемпотентність (скрипт можна запустити двічі без дублювання); пошук шару за назвою, а не за індексом; кожна зміна в undo-групі; результат скрипт пише у файл (`work/.ipc/<id>.out.json`), а не показує в UI; жодних діалогів (`alert`, `confirm`, `prompt`); коротке виконання (довгі операції ділити на кроки); типові пастки ExtendScript. Запуск лише через `ae-run` (розділ 7).
- **Беремо з:** `kumoproductions/mcp-aftereffects` і `TheLlamainator/after-effects-mcp` лишаються тільки як довідковий JSX (інтроспекція, keyframes, easing). Самі MCP-сервери не використовуємо.

### 4.8 `skills/_shared/drive-access.md`
- **Призначення:** правила доступу до Drive для всіх скілів.
- **Вміст:** «ніколи не читай і не пиши в шлях Drive-папки напряму, лише `drive-gate`»; працюй із alias, не зі шляхом; `info` перед `fetch`; при помилці зупинись і спитай; результати не пишемо на Drive, їх переносить людина.

### 4.9 `skills/intake/SKILL.md`

> **Зміна (розділ 16.6):** intake погоджує з дизайнером **критерії готовності** (`AC1`, `AC2`...), після запису `task.md` запускає **незалежний прохід** (суб-агент без історії шукає неоднозначності, кожну знахідку закрито: уточнити, відкласти або відхилити) і робить `mf-gate verify task`. Питає лише блокуючі факти, про смак вирішує сам.
- **Призначення:** прийняти задачу й вибрати флоу.
- **Вміст:** frontmatter (`name`, `description`, `model: inherit`). Кроки: (1) завантажити `studio-rules` (індекс); (2) зчитати індекс флоу (`description` усіх флоу в `studio-rules/flows/` і `.claude/skills/`); (3) визначити тип (нова, правка, ресайз, експорт, інше); (4) знайти флоу або запропонувати `/motion-flow:new-flow`, або вести загальним шляхом; (5) спитати лише те, чого бракує (вхідні файли за alias, цільові формати, дедлайн); (6) записати `.motion/task.md`; (7) handoff на `plan`.
- **Беремо з:** `survey`/`specify` з SDD (структура інтерв'ю), `_shared/socratic-loop.md`. Ідею маршрутів quick/standard/full з SDD (`.route`) поки не беремо.

### 4.10 `skills/plan/SKILL.md`

> **Зміна (розділ 16.6):** кожен крок плану має колонку «Критерії», кожен критерій задачі покритий кроком або записаний у «Не охоплено планом»; крок без критерію (його ніхто не просив) не дозволений. `mf-gate verify plan` перевіряє це до апруву.
- **Призначення:** перетворити задачу на список конкретних змін, які людина апрувить.
- **Вміст:** (1) відмовитись, якщо немає `task.md`; (2) `doctor --flow <name>` для залежностей флоу; (3) `drive-gate fetch` потрібних файлів (проєкт зі структурою для зв'язків) у `work/`; (4) `ae-dump` на копії, зберегти в `snapshots/`; (5) прочитати `motion-system.md`, `protected.md`, `naming.md`, `overrides.md`, інструкції обраного флоу; (6) скласти `plan.md` за форматом (розділ 8): кожен крок це ціль (комп/шар/властивість), зміна, очікуваний результат і **час кадру для перевірки**; (7) явно вказати, чи чіпається щось із `protected.md` (має бути «ні», інакше зупинка й питання); (8) запитати апрув і лише після «так» записати `approved: true` і `plan_sha256`.
- **Беремо з:** `survey` (дамп стану в карту, яку читають наступні кроки), `design` і `tasks` з SDD (план як нумерований список атомарних кроків), `AskUserQuestion` для апруву. Знання про AE-властивості, keyframes, easing: `LobzyJay/motion-design-with-claude` (скіли `motion-design`, `aftereffects-motion`).

### 4.11 `skills/build/SKILL.md`

> **Зміна (розділ 16, п. 5):** журнал `build.log.jsonl` пише сам `ae-run --step N [--attempt M]`, не агент; `guard` блокує ручний запис.
- **Призначення:** виконати апрувнутий план на копії проєкту.
- **Вміст:** (1) перевірка gating (апрув + хеш); (2) для кожного кроку плану згенерувати `jsx/NN-<опис>.jsx`: ідемпотентний (шукає шар за назвою й оновлює, а не дублює), загорнутий в undo-групу з назвою кроку; (3) виконати через `ae-run` **тільки на копії в `work/`**; (4) записати результат у `build.log.jsonl` (крок, статус, час, помилка); (5) зупинитись на першій помилці, максимум N повторів (за замовчуванням 2), далі питання людині; (6) нова версія файлу через `aep-version`; (7) handoff на `check`.
- **Беремо з:** `implement` з SDD (цикл на задачу, `stop_on_red`, `max_red_retries`, трейлери комітів як ідея журналу). Для JSX: `aedev-tools/adobe-agent-skills` (скіл `after-effects`, ExtendScript без UI, тільки macOS), `TerminalSkills/skills/skills/after-effects`. Репо з MCP (`TheLlamainator/after-effects-mcp`, `kumoproductions/mcp-aftereffects`) беремо лише як довідковий JSX для keyframes, easing, пресетів. Перелік типових помилок ExtendScript, які варто закласти в скіл: блокування UI довгими скриптами, робота з індексами шарів замість імен, `setValueAtTime` проти `setValuesAtTimes`.

### 4.12 `skills/check/SKILL.md`

> **Зміна (розділ 16.6):** check простежує **кожен критерій задачі** до доказу (`PASS|FAIL|NOT_VERIFIED`), а не лише рядки плану; критерій без доказу не може бути PASS. Додається незалежний прохід (суб-агент без історії). `mf-gate verify check` перевіряє артефакт до показу людині.
- **Призначення:** довести, що зроблено те, що в плані, і показати людині кадри.
- **Вміст:** (1) відмова без чистого `build.log.jsonl`; (2) `ae-lint` за `rules/checks/`; (3) новий `ae-dump` і звірка з очікуваннями плану (кількість шарів, тривалість, fps, keyframes); (4) `ae-render-frame` на таймкодах із плану плюс перший, останній кадр і середина кожного переходу; (5) відкрити PNG і описати, чи збігається з очікуваним; (6) записати `check.md`: таблиця крок → очікування → факт → вердикт, список кадрів, порушення lint; (7) запитати апрув людини, лише після «так» `approved: true`. Агент не оцінює «красу», а лише звіряє з планом і правилами, а смак лишає людині.
- **Беремо з:** `review` з SDD (трасування вимога → доказ, незалежна перевірка), діагностичний чек-лист зі скіла `motion-design-critique` в `LobzyJay/motion-design-with-claude`. Окремого review-агента в чистому контексті можна додати пізніше (за зразком `agents/reviewer` в SDD).

### 4.13 `skills/deliver/SKILL.md`
- **Призначення:** підготувати фінальні файли за специфікацією студії.
- **Вміст:** (1) відмова без апрувнутого `check.md`; (2) ім'я файлу через `aep-version` за `naming.md`; (3) експорт за `delivery.md` (формат, кодек, розмір, аудіо) через render queue / `aerender`; (4) результати в `work/out/` з контрольними сумами; (5) `deliver.md`: список файлів, розміри, суми, команда «що перенести на Drive і куди» (самого запису на Drive немає); (6) рядок у `.motion/changelog.md`; (7) за налаштуванням `commit_artifacts` у `.motion/state.json` зробити **локальний** коміт текстових артефактів (без push, без бінарників).
- **Беремо з:** `ship` з SDD (верифікація, що результат реально працює, чейнджлог), але без PR і мерджу.

### 4.14 `skills/new-flow/SKILL.md`

> **Зміна (розділ 16.8):** пробний прогін іде в `.motion/` того самого проєкту, але перед ним задача дизайнера безпечно відкладається (`mf-gate archive --park`, повертається `mf-gate restore`) після попередження про ризик і прохання зберегти AE-проєкти. Приклади зберігаються лише як анонімні нотатки, не як файли; чернетка мовою дизайнера, фінальні файли флоу англійською; `mf-flow check` перевіряє флоу.
- **Призначення:** дизайнер створює флоу, агент допитує й складає скіл.
- **Вміст:** (1) вільна розповідь дизайнера, як вона це робить, і реальний приклад (файли на Drive, проєкт, фінал); (2) допит по одному питанню: що запускає задачу, які входи, кроки по порядку, де потрібне рішення людини, що може піти не так, що не можна чіпати, як зрозуміти, що готово; (3) читання прикладу через `drive-gate` і `ae-dump`, звірка з розповіддю («ти сказала 3 формати, а в проєкті п'ять комп»); (4) вимога мінімум двох різних прикладів, або питання «чим цей випадок нетиповий»; (5) чернетка `flow.md` і `SKILL.md` (шаблон нижче) людською мовою для апруву; (6) **dry-run** п'яти кроків на копії прикладу з показом результату; порівняння з тим, що вона зробила сама; правки; (7) запис у `.claude/skills/<flow>/` проєкту; (8) пропозиція запустити `publish-flow`.
- **Правила для генерованого флоу:** флоу налаштовує кроки (що питати в intake, що в плані, які дії, які перевірки), але не може змінити `_shared/safety.md`. `description` має містити 3 приклади фраз запуску й показується дизайнеру на апрув окремо.
- **Беремо з:** скіл `skill-creator` (Anthropic, `anthropics/skills`) для механіки створення, покращення скіла й evals; допит із `socratic-loop`.

### 4.15 `skills/refine-flow/SKILL.md`

> **Зміна (розділ 16.9):** відмінності між результатом агента і правками дизайнера знаходяться порівнянням `ae-dump`; узагальнення (завжди чи лише тут?), правка простими словами; версія піднімається `mf-flow bump` (статус скидається в `draft`, рядок у `CHANGELOG.md` флоу). Встановлену копію флоу зі студійних правил не редагують.
- **Призначення:** оновити флоу з досвіду виконання.
- **Вміст:** після `deliver` спитати «що довелось виправити вручну?»; порівняти з `flow.md`; запропонувати правку (diff людською мовою); після апруву збільшити `version` у frontmatter флоу, дописати рядок у його changelog.
- **Беремо з:** режим «improve» скіла `skill-creator`.

### 4.16 `skills/publish-flow/SKILL.md`

> **Зміна (розділ 16.9):** пакування робить `mf-flow pack` (власний zip-writer, детермінований), перевірка `mf-flow check`; агент сам читає флоу проти `safety.md`; статус `reviewed|approved` ставить лише рев'юер.
- **Призначення:** підготувати флоу до рев'ю.
- **Вміст:** перевірити frontmatter (`name`, `description`, `version`, `owner`, `needs`, `status: draft`), валідувати `SKILL.md`, переконатись, що флоу не обходить `safety.md`, упакувати в `work/out/flow-<name>-<version>.zip` і вивести людині інструкцію «поклади в `_flows-pending/` на Drive». Агент нічого не пише на Drive.
- **Беремо з:** перевірки frontmatter за зразком `scripts/validate_plugin.py` з SDD.

### 4.17 `skills/init-rules/SKILL.md`

> **Зміна (розділ 16, п. 4):** скіл сам копіює скелет із `motion-flow/templates/studio-rules/`, питає назву студії та slug і задає унікальну назву плагіна `<slug>-rules` (у `plugin.json` і `marketplace.json`), бо фрілансер може мати правила кількох студій.
- **Призначення:** один раз на студію згенерувати чернетки правил.
- **Вміст:** запускається в чекауті `studio-rules`. (1) спитати, які Drive-папки дозволені (aliases) і які 1–2 завершені проєкти взяти за еталон; (2) через `drive-gate ls/info` зчитати дерево папок і зразки неймінгу; (3) `ae-dump` еталонних проєктів: комп, шари, прекомпи, fps, розмір, шрифти, ефекти; (4) допит дизайнера: що не можна чіпати, як апрувляться версії, delivery-формати, правила збору асетів; (5) записати чернетки `rules/*.md` з `status: draft` і позначками `TODO: підтвердити`; (6) вивести список відкритих питань. Файл стає правилом (`status: confirmed`) лише після того, як людина прочитала й закомітила.
- **Беремо з:** `survey` з SDD (один раз скануємо й фіксуємо те, що всі наступні етапи читають), `design-system` з SDD (закомічений канон замість налаштувань на людину), ідея «Constitution file» з Roadmap SDD.

### 4.18 `skills/doctor/SKILL.md`
- **Призначення:** перевірка залежностей і налаштувань.
- **Вміст:** читає `deps.json`, для кожної залежності виконує команду перевірки й порівнює версію, виводить таблицю (ок / відсутнє / стара версія) з командою встановлення для macOS і Windows. **Нічого не ставить.** Прапор `--flow <name>` перевіряє тільки `needs` флоу. Додатково перевіряє: AE доступний (`ae-run --ping`), `drive-gate` конфіг валідний, у проєктному `settings.json` є deny-правила, версія `motion-flow` і `studio-rules` збігається з очікуваною.
- **Беремо з:** автовизначення команд зі скриптів SDD (`cmd_*` autodetect), `install.sh` для логіки визначення ОС.

### 4.19 `skills/whats-new/SKILL.md` (M5, опційно)

> **Зміна (розділ 16.9):** `mf-whatsnew` читає `CHANGELOG.md` правил (`## x.y.z`, `- ` рядки, флоу як flow `<назва>`: ...), порівнює з `last_seen_rules_version`, `--mark-seen` змінює лише цей ключ.
- **Призначення:** показати дизайнеру, що змінилось після оновлення плагіна.
- **Вміст:** читає `studio-rules/CHANGELOG.md`, порівнює з `last_seen` у `.motion/state.json`, показує нові або змінені флоу по одному реченню.

### 4.20 `hooks/hooks.json` і `hooks/guard.mjs`

> **Зміна (розділ 16, п. 3):** небезпечний git (`push`, `reset --hard`, `clean -f`, `checkout -f`) і `rm`/`mv` усередині `work/` не блокуються, а запитують підтвердження (`ask`); поза `work/`, на Drive і в `~/.motion-flow/` блок жорсткий. Matcher ширший: ще `NotebookEdit`, `Glob`, `Grep`, `PowerShell`, `Monitor`.
- **Призначення:** жорсткі запобіжники поза промптами.
- **Вміст:** PreToolUse-хук для `Read`, `Write`, `Edit`, `Bash`. Блокує: будь-які шляхи всередині коренів із `~/.motion-flow/roots.json` (доступ лише через `drive-gate`); `rm`/`mv` поза `work/`; `git push`, `git reset --hard`, `git clean -fd`, `git checkout --force`; запуск ExtendScript і AE (`afterfx`, `osascript` з `DoScriptFile`, `aerender`) поза `ae-run`, `ae-dump`, `ae-render-frame`. Повертає зрозуміле повідомлення, що заборонено й що робити натомість.
- **Беремо з:** пишемо з нуля. Схему hooks **[перевірити]** в документації Claude Code. Дублюй критичні заборони в `permissions.deny` проєктного `settings.json`.

### 4.21 `bin/drive-gate`
Повна специфікація в розділі 6.

### 4.22 `bin/aep-version`
- **Призначення:** обчислити наступне ім'я версії файлу за правилами студії.
- **Вміст:** вхід: поточне ім'я, шлях до `naming.md` (або конфіг із регулярним виразом версії); вихід: наступне ім'я (`проєкт_v03.aep` → `проєкт_v04.aep`), не перезаписує існуючі файли. Покрити юніт-тестами.

### 4.22a `bin/ae-run`, `bin/ae-dump`, `bin/ae-render-frame`, `lib/jsx/`
- **Призначення:** єдиний шлях запуску JSX і рендеру в AE (механізм у розділі 7). Тонкі обгортки, без бізнес-логіки.
- **Вміст:**
  - `ae-run --project <work/...aep> --script <path.jsx> --undo <назва> [--timeout N]` і `ae-run --ping`;
  - `ae-dump --project <work/...aep> --out <path.json>` (запускає `lib/jsx/dump.jsx`, результат за схемою розділу 7);
  - `ae-render-frame --project <work/...aep> --comp <назва> --time <сек> --out <path.png>`;
  - `lib/jsx/dump.jsx` (дамп проєкту в JSON) і `lib/jsx/helpers.jsx` (undo-група, пошук шару за назвою, запис результату у файл, обробка помилок).
- **Тести (обов'язкові, без AE):** розбір аргументів; відхилення будь-якого шляху поза `work/` (`..`, симлінки, абсолютні шляхи); таймаут; lock-файл (другий запуск одночасно відмовляється); формування `.in.json`/`.out.json`; зрозумілі помилки. Сам запуск AE тестує людина на машині дизайнера.
- **Беремо з:** довідковий JSX з `kumoproductions/mcp-aftereffects` і `TheLlamainator/after-effects-mcp` для інтроспекції (дамп).

### 4.23 `bin/ae-lint`
- **Призначення:** машинні перевірки проєкту за правилами студії.
- **Вміст:** вхід: JSON-дамп і папка `rules/checks/`; вихід: JSON-список порушень (`rule`, `severity`, `where`, `message`). Кожна перевірка це маленький декларативний файл (`fps == 25`, `comp.name` відповідає regex, відсутні шрифти й медіа, шари з назвами за замовчуванням на кшталт «Shape Layer 1», порушення `protected.md`). Код перевірок простий, без залежностей, запускається на дампі без AE.

### 4.24 `deps.json`
- **Призначення:** декларація залежностей.
- **Вміст:** масив об'єктів: `name`, `check` (команда), `min_version`, `version_regex`, `install` (`macos`, `windows`), `required_by` (скіли або флоу), `notes`. Початково: AE (мін. версія), `node` (мін. 24), `ffmpeg`; `whisper` як опційна, з указанням конкретної реалізації та моделі (вибрати одну й зафіксувати версію).
- **Правило:** власні скрипти плагіна без зовнішніх npm-залежностей (лише вбудовані модулі Node), тому `node_modules` не потрібен. Якщо залежність усе ж знадобиться, фіксувати її lock-файлом. Нічого глобально.

### 4.25 `DRIVE.md`
- **Призначення:** readme для агента про Drive.
- **Вміст:** що таке aliases; як виглядає дерево (заповнює `studio-rules/rules/drive.md`); правила: ніколи не звертайся до шляху Drive-папки напряму; завжди `info` перед `fetch`; працюй лише з копією в `work/`; нічого не записуєш на Drive; при помилці зупинись і спитай; пастки stream-режиму й `.gdoc/.gsheet`.

### 4.26 `templates/`
- `task.md`, `plan.md`, `check.md`, `deliver.md`, `overrides.md`, `flow.md`, `flow-SKILL.md` (шаблони з розділу 8).
- `roots.example.json` (приклад локального конфігу `drive-gate`).
- `settings.project.json` (marketplace, enabledPlugins, permissions.deny).
- `gitignore.project` (рядок `work/`, `.motion/state.json`).
- `rules/*.md` порожні шаблони з секціями й `status: draft`.
- **Беремо з:** структура `skills/<n>/templates/` в SDD.

### 4.27 `scripts/validate_plugin.mjs`
- **Призначення:** CI-перевірка плагіна.
- **Вміст:** маніфести валідні; у кожного `SKILL.md` є `name`, `description`, `model`; посилання на `_shared/*.md` розв'язуються; кожен скіл, що споживає артефакт, містить перевірку gating; жоден скіл не згадує `put`/delete Drive; `deps.json` валідний; frontmatter шаблонів коректний.
- **Беремо з:** `genkovich/sdd/scripts/validate_plugin.py` (ідея набору інваріантів), підлаштувати під наші правила.

### 4.28 `evals/`
- **Призначення:** регресійні перевірки.
- **Вміст:** санітизовані JSON-дампи реальних проєктів (фікстури); очікувані результати `ae-lint` на них; тести `drive-gate` (розділ 6); тести `aep-version`; тести спрацювання `description` (набір фраз → який скіл/флоу має запуститись).
- **Беремо з:** папка `evals/` в SDD і механіка evals у `skill-creator`.

## 5. motion-marketplace

> **Зміна (розділ 16, п. 1):** розділ застарів: окремого репо немає, каталог у `motion-flow/.claude-plugin/marketplace.json` (`source: "./"`). Скелет правил теж є каталогом із одного плагіна, тож встановлення без GitHub: `/plugin marketplace add <папка>`.

### 5.1 `.claude-plugin/marketplace.json`
- **Вміст:** `name`, `owner`, масив `plugins` з двома записами (`motion-flow`, `studio-rules`), у кожного `source` на GitHub-репо та `description`. Приватний `studio-rules` вимагає git-доступу в кожного учасника.
- **Беремо з:** самомаркетплейс у `genkovich/sdd/.claude-plugin/marketplace.json`. Точну схему `source` **[перевірити]**.

### 5.2 `README.md`
- **Вміст:** для дизайнера, українською, по кроках: як додати marketplace, як увімкнути плагіни, як запустити `doctor`, як створити флоу, що робити при помилці. Для технічної людини: як випускати версію, як рев'юїти флоу.

## 6. Специфікація `drive-gate` (локальний бекенд)

> **Зміна (розділ 16, п. 2):** `roots.json` це перелік Drive-папок **на комп'ютері**; які з них доступні проєкту, обирається в проєкті (`.motion/drive.json`). Без файла або з порожнім списком: без Drive. Змінної середовища для підміни конфігу немає.

Мова: Node.js (ESM, `.mjs`), лише вбудовані модулі, без зовнішніх залежностей. Без мережі.

**Конфіг.** Aliases (спільні) задаються в `studio-rules/rules/drive.md` (назви й призначення). Конкретні шляхи на машині користувача в `~/.motion-flow/roots.json`:
```json
{ "roots": { "assets": "/Users/anna/Google Drive/Studio/Assets",
             "projects": "/Users/anna/Google Drive/Studio/Projects" },
  "work_dir": "work" }
```

**Команди (усі пишуть JSON у stdout, ненульовий код при помилці):**
- `ls <alias> [subpath]`: список файлів і папок з розмірами й датами змін.
- `info <alias> <relpath>`: розмір, дата, чи файл локально завантажений (stream-режим), контрольна сума за запитом.
- `fetch <alias> <relpath> --to work/ [--with-deps]`: копіює файл у `work/` зі збереженням відносних шляхів. Для `.aep` `--with-deps` копіює структуру, на яку посилається проєкт (за дампом), щоб зв'язки не ламались. Перевіряє розмір після копіювання, чекає завантаження stream-файлу (таймаут), порівнює контрольні суми.
- `log [--tail N]`: читає журнал викликів.

**Інваріанти:**
1. Кожен шлях проходить `realpath`, і результат має лежати всередині кореня alias. Відхиляти `..`, симлінки назовні, абсолютні шляхи, невідомий alias.
2. Жодних операцій запису, видалення, переміщення чи перейменування на стороні Drive. Команди `put`, `rm`, `mv`, `rename`, `share` не існують.
3. Запис дозволений лише у `work/` проєкту.
4. Кожен виклик у журнал `~/.motion-flow/drive-gate.log` (час, команда, alias, шлях, результат).
5. Помилка stream-режиму (файл не завантажився) повертає зрозуміле повідомлення для людини, а не мовчазний порожній файл.

**Тести (обов'язкові):** `../` вихід, симлінк назовні, невідомий alias, файл без прав, нульовий розмір (заглушка stream), великий файл, `fetch` не змінює оригінал (порівняти mtime і суму), відсутність будь-яких записів поза `work/`.

## 7. Запуск JSX у After Effects (без MCP)

**Принцип.** Скіли працюють з трьома командами (`ae-run`, `ae-dump`, `ae-render-frame`), а не з сервером. MCP-серверів немає. Репо з AE-MCP (`kumoproductions/mcp-aftereffects`, `TheLlamainator/after-effects-mcp`, `Dakkshin/after-effects-mcp`) використовуємо лише як довідковий JSX. Репо `anthropics/ae-mcp` не використовувати: походження сумнівне.

**Механізм запуску** **[перевірити на реальних версіях AE]**:
- Windows: `afterfx.exe -r <script.jsx>` (або `-s` для рядка коду).
- macOS: `osascript` з `DoScriptFile` для застосунку After Effects.
- У налаштуваннях AE увімкнено «Allow Scripts to Write Files and Access Network» (інакше скрипт не запише результат).
- Експорти: `aerender` або render queue.
- Запасний варіант: панель-міст (CEP/UXP). У v0.1 не робимо.

**Передача результату.** `ae-run` записує вхід у `work/.ipc/<id>.in.json` (проєкт, параметри, шлях виходу), скрипт читає його й пише результат у `work/.ipc/<id>.out.json`. `ae-run` чекає появи `.out.json` до таймауту. На один запуск діє lock-файл (`work/.ipc/ae.lock`): другий одночасний запуск відмовляється.

**Контракти:**

| Команда | Контракт |
|---|---|
| `ae-run --ping` | Повертає `{ok, aeVersion, projectOpen, projectPath}`. |
| `ae-run --project <work/...aep> --script <path.jsx> --undo <назва> [--timeout N]` | Виконує JSX **лише на проєкті з `work/`**, у undo-групі `<назва>`. Повертає `{ok, result, error, durationMs}`. |
| `ae-dump --project <work/...aep> --out <path.json>` | Записує JSON за схемою нижче. Не змінює проєкт. |
| `ae-render-frame --project <work/...aep> --comp <назва> --time <сек> --out <path.png>` | Записує PNG кадру. |

**Безпека.** `ae-run` єдиний шлях запуску JSX (`ae-dump` і `ae-render-frame` викликають його всередині). Працює лише з копіями в `work/`. `hooks/guard.mjs` блокує будь-який інший запуск AE і ExtendScript (див. 4.20).

**Схема дампа (скорочено):**
```json
{
  "ae": {"version": "..."},
  "project": {"path": "...", "bitsPerChannel": 8},
  "footage": [{"name": "...", "path": "...", "missing": false}],
  "fonts": ["..."],
  "comps": [{
    "id": 1, "name": "...", "width": 1920, "height": 1080, "fps": 25, "duration": 12.0,
    "layers": [{
      "index": 1, "name": "...", "type": "shape|text|solid|precomp|footage|null",
      "inPoint": 0, "outPoint": 12, "parent": null, "enabled": true, "locked": false,
      "transform": {"position": [0,0], "scale": [100,100], "rotation": 0, "opacity": 100},
      "effects": ["..."], "expressions": {"transform.position": "..."},
      "keyframes": {"transform.opacity": [{"t": 0, "v": 0, "ease": "..."}]}
    }]
  }]
}
```

## 8. Формати артефактів (`templates/`)

**`task.md`**
```markdown
---
id: 2026-10-19-resize-01
type: resize|new|edit|export|other
flow: resize-formats        # або null
status: draft|ready
inputs:
  - alias: projects
    path: Brand/Spring/spring_v07.aep
deadline: null
---
## Description
## Acceptance criteria        # "- AC1: <результат, який видно або можна виміряти>"
## Known facts and assumptions
## Open questions
```

**`plan.md`**
```markdown
---
task_id: 2026-10-19-resize-01
status: draft            # draft | approved
approved_at: null
plan_sha256: null        # хеш тіла плану на момент апруву
project_copy: work/spring_v07.aep
touches_protected: false
needs: [ffmpeg]
---
## Steps
| # | Target (comp/layer/property) | Change | Expected result | Frame to check | Criteria |
|---|---|---|---|---|---|
## Not covered by the plan   # критерії задачі без кроку, з причиною; "- none"
## Risks
## Questions for the designer
```

**`check.md`**
```markdown
---
task_id: 2026-10-19-resize-01
verdict: PASS         # PASS | ISSUES
approved: false
approved_at: null
---
## Comparison with the plan
| # | Expected | Actual | Verdict |
## Acceptance criteria
| AC | Evidence | Verdict |          # PASS | FAIL | NOT_VERIFIED
## Lint
## Frames
- work/frames/step01_t2.5s.png
## Independent review   # or "not run: <reason>"
## Open questions
```

**`flow.md` (флоу)**
```markdown
---
name: resize-formats
version: 0.1.0
owner: anna
status: draft | reviewed | approved
needs: [ffmpeg]
---
## What this flow is for
## What starts it (3 example phrases)
## Inputs
## Steps in order
## Where the designer decides
## What must not be touched
## How to tell it is done
## Examples (links to example/)
```

**`flow-SKILL.md`:** frontmatter `name`, `description` (коли запускати, з прикладами фраз), `model: inherit`; тіло: як цей флоу налаштовує `intake`, `plan`, `build`, `check`, `deliver`, і посилання на `flow.md`. Обов'язково: «не змінює і не послаблює `_shared/safety.md`».

**`overrides.md`:** винятки цього проєкту від правил студії, кожен з причиною і хто дозволив.

**`state.json`:** `{"last_seen_rules_version": "", "commit_artifacts": false}`.

## 9. Інваріанти безпеки

1. Агент працює лише з копіями в `work/`; оригінали на Drive не змінюються.
2. Кожна зміна проєкту виконується в undo-групі.
3. Жодних операцій видалення, переміщення чи перейменування на Drive.
4. Жодних прямих звернень до Drive-папки: тільки `drive-gate`; це забезпечують `hooks/guard.mjs` і `permissions.deny`.
5. Агент нічого не ставить на машину: тільки показує команди (`doctor`).
6. Флоу не може послабити ці інваріанти.
7. Апрув тільки від людини, після явної відповіді.
8. При несподіванці (відсутній файл, зламані зв'язки, не збігається хеш) зупинка й питання.
9. Нечутливі дані: не логувати вміст клієнтських проєктів поза `work/`.

## 10. studio-rules: файл за файлом

Усі правила мають frontmatter `status: draft|confirmed`, `confirmed_by`, `confirmed_at`. Скіли попереджають, якщо читають `draft`.

- **`skills/studio-rules/SKILL.md`**: індекс правил. `description`: «Правила студії <назва>: неймінг, motion-system, delivery, Drive, protected». Тіло: перелік файлів і для кожного коли його читати (таблиця з візуальної схеми: naming → build/check, project-template → intake/build, motion-system → plan/build, protected → plan/build, delivery → deliver, drive → deliver, checks → check, flows → intake).
- **`rules/naming.md`**: шаблони імен файлів, версій, комп, шарів, прекомпів; приклади правильного й неправильного; regex для `ae-lint`.
- **`rules/motion-system.md`**: easing-криві, стандартні тайминги (у кадрах і секундах), палітра, шрифти, правила руху бренду, заборонене.
- **`rules/protected.md`**: що не можна чіпати (еталонні комп, брендові прекомпи), кому дзвонити, якщо потрібна правка.
- **`rules/delivery.md`**: формати, кодеки, bitrate, роздільності, safe zones, аудіо-рівні, куди класти фінали.
- **`rules/drive.md`**: перелік aliases (без конкретних шляхів машин), структура дерева, правила версій, де `_flows-pending/`.
- **`rules/project-template/`**: шаблонний `.aep` (fps, розмір, колір), структура папок для нового проєкту.
- **`rules/checks/`**: декларативні перевірки для `ae-lint`.
- **`flows/`**: затверджені флоу; кожен у своїй папці за форматом з розділу 8, з `example/`.
- **`CHANGELOG.md`**: що змінилось у правилах і флоу (читає `whats-new`).
- **Беремо з:** змістовно нічого готового немає, це заповнює `init-rules` з дизайнером. Структурно: `docs/design-system.md` і `architecture-map.md` з SDD як приклад «закоміченого канону, який читають усі етапи».

## 11. Проєкт: файл за файлом

> **Зміна (розділ 16, п. 2 і 6):** `permissions` має `deny` (Drive і конфіг, лише `Read`/`Edit`-правила шляхів) і `ask` (небезпечний git); `enabledPlugins` містить `motion-flow@motion` і **один** плагін правил обраної студії (`mf-init --rules <плагін>@<каталог>`) або жодного. `CLAUDE.md` проєкту написаний англійською з рядком «reply to the designer in Ukrainian».

- **`.claude/settings.json`**: `extraKnownMarketplaces` (motion-marketplace), `enabledPlugins` (`motion-flow@motion`, `studio-rules@motion`), `permissions.deny` для прямих Read/Write/Edit по шляху Drive-папки, для Drive-інструментів (`trash_file`, `update_file`, `share_file`) і для небезпечних git-команд. Точні ключі й схему **[перевірити]**.
- **`.gitignore`**: `work/`, `.motion/state.json`.
- **`CLAUDE.md`** (коротко, українською): «Працюй через `/motion-flow:intake`. Не звертайся до Drive напряму. Працюй лише з копіями в `work/`. Перед змінами показуй план і чекай апрув.»
- **`.motion/`**: артефакти з розділу 8.
- **`jsx/`**: згенеровані скрипти (у git, якщо проєкт у git).
- **Scope установки плагінів:** `project` для обох плагінів (однакова версія в усіх), `local` для власних експериментів розробника.

## 12. Порядок реалізації

**M0. Каркас.** Три репо, `plugin.json`, `marketplace.json`, `validate_plugin.mjs`, README. *Приймання:* `/plugin marketplace add <локальний шлях>` і встановлення обох плагінів працюють, валідатор зелений.

**M1. Безпека й Drive.** `drive-gate` + тести, `hooks/guard.mjs`, `permissions.deny` шаблон, `doctor` (перевірка `deps.json`, конфігів). *Приймання:* усі тести розділу 6 проходять; спроба агента прочитати Drive-шлях напряму блокується; `doctor` показує коректну таблицю й нічого не ставить.

**M2. Запуск JSX в AE.** `ae-run`, `ae-dump`, `ae-render-frame`, `lib/jsx/`, `ae-scripting.md`, фікстури дампів, `ae-lint`, `aep-version`. *Приймання:* юніт-тести без AE проходять; на машині дизайнера `ae-run --ping`, `ae-dump`, `ae-run` на копії та `ae-render-frame` працюють на реальній версії AE.

**M3. П'ять кроків.** `intake`, `plan`, `build`, `check`, `deliver`, `_shared/*`, шаблони, gating, handoff. *Приймання:* одна реальна проста задача (наприклад, ресайз) проходить від `intake` до `deliver` на машині дизайнера; спроба запустити `build` без апруву відмовляється; зміна `plan.md` після апруву блокує `build`.

**M4. Правила студії.** Скелет `studio-rules`, `init-rules`. *Приймання:* `init-rules` на 1–2 реальних проєктах створює чернетки з `TODO: підтвердити`; дизайнер підтверджує їх; `plan` і `check` починають їх використовувати.

**M5. Флоу.** `new-flow`, `refine-flow`, `publish-flow`, `whats-new`. *Приймання:* дизайнер без допомоги створює флоу за двома прикладами; dry-run проходить; пакет ліг у `_flows-pending/`; після рев'ю флоу з'являється в `studio-rules/flows/`, а в інших з'являється після оновлення плагіна.

**M6. Пілот.** Evals, українська документація для дизайнерів, два тижні реального використання з однією людиною. Усі ручні виправлення результатів агента йдуть у `refine-flow` і в правила.

## 13. Що перевірити до старту

1. Схеми `plugin.json`, `marketplace.json`, hooks і `settings.json` у поточній документації Claude Code.
2. Ліцензії репо, з яких беремо довідковий код і знання: `kumoproductions/mcp-aftereffects`, `TheLlamainator/after-effects-mcp`, `Dakkshin/after-effects-mcp` (довідковий JSX), `LobzyJay/motion-design-with-claude`, `aedev-tools/adobe-agent-skills`, `TerminalSkills/skills` (знання й скіли). Перед використанням фрагментів перевір, що ліцензія це дозволяє.
3. Механізм запуску JSX (`afterfx.exe -r`, `osascript` з `DoScriptFile`) на реальних версіях AE і ОС дизайнерів, а також поведінка, коли AE вже запущений (відкритий інший проєкт, модальні вікна, друга копія процесу).
4. Версія AE і ОС у дизайнерів (Windows чи macOS): від цього залежать команди запуску й `deps.json`.
5. Режим Drive for Desktop у дизайнерів: stream чи mirror.
6. Чи є git у дизайнерів. Якщо ні, `commit_artifacts` лишається вимкненим.
7. Яка реалізація whisper потрібна й чи справді потрібна. Перетин з `aerender`/Media Encoder для ffmpeg.

## 14. Що свідомо не робимо (поки)

- Етапи brief, storyboard, animation-spec як окремі кроки.
- Окремий незалежний review-агент і gating на десять етапів.
- Запис на Drive (`put`) і бекенд через Drive API.
- Підтримка Codex/Cursor.
- Двосторонню синхронізацію docs ↔ Drive.

Додавай це лише коли команда сама впреться в потребу.

## 15. Джерела для вивчення

- `genkovich/sdd` (MIT): `skills/_shared/` (handoff, socratic-loop, ask-style, interview-depth, size-matrix, tool-adapters, agent-roster), `skills/survey`, `skills/design-system`, `skills/implement`, `skills/review`, `skills/ship`, `skills/fix`, `scripts/validate_plugin.py`, `evals/`, `.claude-plugin/`, `install.sh`.
- `anthropics/skills`: скіл `skill-creator`.
- `kumoproductions/mcp-aftereffects`, `TheLlamainator/after-effects-mcp`, `Dakkshin/after-effects-mcp`: лише довідковий JSX (інтроспекція, keyframes, easing, панель-міст як запасний варіант); MCP-сервери не використовуємо.
- `LobzyJay/motion-design-with-claude`: скіли знань про моушн (`motion-design`, `aftereffects-motion`, `motion-design-critique`).
- `aedev-tools/adobe-agent-skills` і `TerminalSkills/skills/skills/after-effects`: скіли ExtendScript для AE.
- Документація: https://docs.claude.com/en/docs/claude-code/plugins-reference

## 16. Рішення, ухвалені під час розробки

Розділ фіксує, чим реалізація відрізняється від першої редакції спеки, і чому. Де він суперечить розділам вище, діє цей розділ.

### 16.1 Каталог і правила студії
1. **Каталог.** Окремого `motion-marketplace` немає. `motion-flow/.claude-plugin/marketplace.json` (назва `motion`, один запис, `source: "./"`). Встановлення плагіна: `motion-flow@motion`.
2. **Скелет правил** у `motion-flow/templates/studio-rules/`: `.claude-plugin/plugin.json` і `marketplace.json`, скіл-індекс `skills/studio-rules/SKILL.md`, `rules/*.md` (усі `status: draft`), `rules/checks/` з прикладами в `_examples/`, `flows/`, `CHANGELOG.md`, `README.md`, `.gitignore` (службові теки `work/`, `.motion/`, `.claude/`, `CLAUDE.md` не потрапляють у репо правил).
3. **Унікальна назва плагіна правил** `<slug>-rules` (наприклад `acme-rules`), однакова в маніфесті, у каталозі та в записі каталогу. Скіл усередині лишається `studio-rules` (простір імен дає плагін). Назва не починається з `claude` чи `anthropic`.
4. **Кілька студій на одному комп'ютері (фрілансер).** Кожна студія має свою папку правил, яка є й плагіном, і каталогом: `/plugin marketplace add <папка>` встановлює без GitHub. У проєкті вмикається **рівно один** плагін правил (область `project`, ніколи `user`).
5. **Вибір студії в проєкті.** `init-project` питає, правила якої студії діють (або жодної), і пише `enabledPlugins["<плагін>@<каталог>"] = true` у `.claude/settings.json` (`mf-init --rules <id>` / `--no-rules`). Існуючий `settings.json` змінюється лише цим ключем і лише з явним `--rules`; тоді `guard` просить підтвердження. Увімкнення в `settings.json` плагін не встановлює: на кожному комп'ютері один раз `claude plugin install <id> --scope project` (це робить дизайнер, не агент).
6. **doctor** показує, які плагіни правил увімкнені в проєкті (інформаційно), і попереджає, якщо їх більше одного.

### 16.2 Drive
1. `~/.motion-flow/roots.json` це перелік Drive-папок комп'ютера, його створює `setup` (скіл `/motion-flow:setup`, `mf-setup`): знаходить Drive (`--detect`), перевіряє вибір (`--dry-run`), пише файл. Перший запис без питань, зміна існуючого конфігу питає підтвердження. Конфіг не підміняється змінними середовища.
2. Вибір Drive робиться **для кожного проєкту** в `.motion/drive.json` (`{"aliases": [...]}`); `mf-init --drive a,b` або `--no-drive`. `drive-gate` бере лише обрані папки: `drive_disabled`, `no_drive`.
3. **Режим без Drive:** конфіг не обов'язковий; дизайнер сама кладе файли в `work/`.
4. Дублі захисту: `guard` читає конфіг комп'ютера, тож блокує всі Drive-папки в усіх проєктах, незалежно від вибору проєкту.

### 16.3 Гейтинг і журнал
1. `mf-gate` (`require`, `hash`, `approve`, `status`, `archive`) реалізує розділ 3 кодом. Хеш плану рахується від тіла (CRLF→LF, без кінцевих пробілів); `status` і `approved_at` у хеш не входять.
2. Причини відмов: `file_missing`, `task_not_ready`, `plan_not_approved`, `plan_changed_after_approval`, `task_mismatch`, `build_log_missing`, `build_log_invalid`, `build_failed`, `check_not_approved`; `approve` ще `plan_incomplete`, `check_incomplete`.
3. `mf-gate approve` завжди показує вікно підтвердження Claude Code (`guard`), а поля апруву (`status: approved`, `approved: true`, `approved_at`, `plan_sha256`) файловими інструментами писати заборонено.
4. `build.log.jsonl` пише тільки `ae-run --step`; для запусків, що не дійшли до скрипта (таймаут, відмова), теж пишеться рядок із `ok: false`.
5. `.motion/` тримає одну задачу; нова починається після `mf-gate archive [--abandon]` (переносить артефакти в `.motion/archive/<id>/`, нічого не видаляє, бо `mv`/`rm` для агента заблоковані).
6. `deliver.md` (формат у спеці не був визначений): `task_id`, `status: delivered`, `delivered_at`; таблиця файлів (розмір, sha256); `## Куди покласти`; відкриті питання. Є `.motion/changelog.md`.
7. Експорт відео: `deliver` питає дизайнера, чи рендерити. Автоматичного `ae-export` поки немає: дизайнер експортує в AE у `work/out/` за налаштуваннями з `delivery.md`, `deliver` перевіряє файл (`ffprobe`, якщо є). Контрольні суми: `mf-sum`.

### 16.4 After Effects
1. Запуск на macOS: AppleScript `DoScript` із `$.evalFile(<обгортка>)` і `with timeout of 7200 seconds` (не `DoScriptFile`: на AE 2024+ повідомляють про зависання). Windows: `AfterFX.exe -r`. `osascript`, що завис після таймауту, зупиняється; AE не закривається.
2. Обгортка скрипта: BOM, налаштування IPC, `helpers.jsx`, текст скрипта як **рядок**, що компілюється через `new Function` у `try/catch`. Синтаксична помилка, throw поза `mf.runIpc` або скрипт без `mf.runIpc` повертаються як помилка в результаті, а не діалогом AE. Результат, що не серіалізується, замінюється явною помилкою.
3. **Політика скриптів агента** (`ae-run` відмовляє): `system.callSystem`, `.execute`, `eval`/`evalFile`/`new Function`, `Socket`, прямі `File`/`Folder`, доступ до глобалів за назвою, `app.open`/`quit`/`project.close`/`saveWithDialog`/`executeCommand`, `getenv`. Файли лише через `mf.workFile`/`mf.workFolder` (обмежені `work/`). Скрипти плагіна довірені. Перевірка заздалегідь: `node scripts/check_jsx.mjs --policy jsx/`.
4. Параметри скрипта: `ae-run --params '<json>'` (у `input.params`); ключі `__proto__`, `constructor`, `prototype` заборонені.
5. `ae-render-frame`: `saveFrameToPng` пише PNG асинхронно, тому інструмент видаляє старий файл, а після запуску чекає, поки новий з'явиться й перестане рости. Кольори кадру можуть відрізнятися від в'ювера AE.
6. `ae-dump --out` дозволений у `work/` і в `.motion/snapshots/`; `ae-render-frame --out` лише в `work/`. Проєкт для `ae-run`/`ae-dump`/`ae-render-frame` лише всередині `work/`; якщо в AE відкритий інший проєкт, відмова (чужий не закривається).
7. `ae-lint`: 10 типів перевірок (`comp_fps`, `comp_size`, `comp_duration`, `comp_name`, `layer_name`, `default_names`, `footage_missing`, `fonts_allowed`, `project_bits`, `protected_unchanged`); `protected_unchanged` порівнює з дампом «до роботи» (`--baseline`).
8. `doctor --ping-ae` реально запускає скрипт в AE; без прапора лише перевіряє, що AE встановлений.

### 16.5 Залежності й інше
1. `node` мінімум **24**. Whisper: **whisper.cpp** (`whisper-cli`); `doctor` рекомендує найбільшу модель, що вміщується в половину оперативної пам'яті, і показує команду завантаження, нічого не качає.
2. `git` не в `deps.json`.
3. Текст у репо англійською; усе, що читає дизайнер, агент пише українською. Ліцензію ще не обрано.
4. Інструкція для дизайнерів (T6.2) живе в `README.md` репо `motion-flow`.
5. Ручні перевірки: `_temp/manual-test-cases.md` (M0–M4).

### 16.6 Приймання задачі й перевірка результату (за результатами звірки з референсами)
1. **Критерії готовності** в `task.md` (`## Acceptance criteria`, рядки `- ACn: ...`) це контракт задачі: спостережувані, з числами. Ідентифікатори не змінюються після апруву плану.
2. **Наскрізне трасування:** прохання → критерій → крок плану → доказ у `check`. План: кожен крок обслуговує хоча б один критерій (інакше це крок, якого ніхто не просив), кожен критерій має крок або запис у `## Not covered by the plan` із причиною (людина бачить це на апруві). Check: рядок на кожен критерій із доказом і вердиктом; `PASS` без доказу, який можна процитувати, заборонений; `verdict: PASS` лише коли все `PASS`.
3. **Незалежний прохід** (`skills/_shared/independent-review.md`): суб-агент без історії розмови читає лише файли. Для `intake` шукає, де двоє виконавців зроблять різне; для `check` перевіряє докази критерій за критерієм. Знахідки без цитати відкидаються; `NO_FINDINGS`, якщо нічого. Результат у `## Independent review`; розбіжності з власним висновком показуються дизайнеру, дружніший вердикт мовчки не вибирається. Без суб-агента проходить сам скіл, але чесно пише «не виконувалась».
4. **Структурний self-check:** `mf-gate verify <task|plan|check>` читає артефакт з диска й перевіряє фіксований список пунктів (ключі, шаблонний текст, критерії та їхнє покриття, кадри, що існують, секції). Виводить `self-check: N/N pass` або перелік невдалих пунктів; скіл виправляє й повторює не більше двох разів, залишок показує чесно. Рядок самоперевірки обов'язковий у handoff. `mf-gate require plan` відмовляє `task_incomplete`, `mf-gate approve plan|check` відмовляє `plan_incomplete|check_incomplete`, коли артефакт не проходить перевірку.
5. **Походження:** ідеї з SDD (`clarify`, `review`, `self-check`, критерії приймання), `motion-design-with-claude` (лише блокуючі питання, референс як напрям, один діагноз за раз) та aedev-tools (збір контексту перед змінами, підтвердження руйнівних дій). Тексти не копіювалися.

### 16.7 Мова
1. **Усе в репозиторії (плагін, скіли, шаблони, документи, код, тести, повідомлення інструментів) англійською.** Українська лише в чаті з дизайнером: її виробляє агент під час роботи (скіли кажуть «говори з дизайнером українською»). Винятки: ця специфікація і `TASKS.md` (переклад тасок і README англійською заплановано в T6.2) та тестові рядки, що навмисно перевіряють не-ASCII (позначені `non-ASCII test data`). Тест `scripts/language.test.mjs` забороняє кирилицю в решті файлів.
2. **Заголовки артефактів англійською:** `## Description`, `## Acceptance criteria`, `## Known facts and assumptions`, `## Open questions` (task.md); `## Steps`, `## Not covered by the plan`, `## Risks`, `## Questions for the designer` (plan.md); `## Comparison with the plan`, `## Acceptance criteria`, `## Lint`, `## Frames`, `## Independent review`, `## Open questions` (check.md); `## Files`, `## Where to put them` (deliver.md); таблиці `Target | Change | Expected result | Frame to check | Criteria` і `AC | Evidence | Verdict`. «Порожньо» пишеться `- none`, «незапущено» `not run: <reason>`. Там, де розділи вище показують українські заголовки, діє цей розділ.
3. **Handoff-блок** описаний англійською (`What was done`, `What to check`, `Next command`), а друкується дизайнеру українською.

### 16.8 Створення флоу (`new-flow`)
1. **Перед пробним прогоном дані дизайнера не втрачаються:** агент попереджає про ризик, просить зберегти й закрити зайві AE-проєкти, питає явну згоду й лише тоді виконує `mf-gate archive --park` (файли задачі переносяться в `.motion/archive/<id>/` з позначкою `PARKED`, нічого не видаляється). Після прогону прогін архівується (`archive --abandon`), а відкладена задача повертається `mf-gate restore <id>` байт у байт, схвалення плану лишається чинним. `restore` не перезаписує задачу, що вже є в `.motion/`.
2. **Приклади це анонімні нотатки** (`example/README.md`: `## Example N` або `## Why only one example`), не файли й не посилання на файли: дизайнер може попросити видалити приклад після створення флоу, тож флоу від оригіналів не залежить. Наприкінці агент пропонує видалити робочі копії, дампи й чернетки з `work/` (лише з підтвердженням, лише в `work/`).
3. **Мова:** чернетку для схвалення агент пише мовою, якою говорить дизайнер, після схвалення фінальні `SKILL.md`, `flow.md`, `example/README.md` пишуться англійською, а дизайнеру переказується їхній зміст її мовою.
4. **`mf-flow check <папка флоу>`** (`lib/mf-flow.mjs`): файли, frontmatter (`name` = назва папки, `version` x.y.z, `owner`, `status`, `needs` із `deps.json`), мінімум 3 фрази-приклади в `description`, 8 секцій `flow.md`, речення про безпеку, заборонені вказівки (пропуск гейтів і апрувів, самоапрув, `mf-gate approve`, запис у налаштування безпеки, `mf-setup`/`mf-init`, пряма робота з AE, небезпечні команди, запис на Drive), відсутність машинних шляхів, шляхів Drive й e-mail, приклади (не більше 200 КБ, лише `.md/.json/.txt`), англійська мова.
5. **Походження:** `skill-creator` (Anthropic, Apache-2.0): спершу витягти з розмови вже сказане, «наполегливий» опис для запуску, короткі реалістичні тестові фрази, пояснення «чому» замість голих вимог. Тексти не копіювалися.

### 16.9 Життєвий цикл флоу: оновлення, публікація, новини
1. **`mf-flow bump <папка> <patch|minor|major> --note "<англійською>"`:** піднімає `version` у `flow.md`, скидає `status` у `draft` (змінений флоу рев'юється знову), додає запис угорі `CHANGELOG.md` флоу. Нотатка однорядкова, англійська.
2. **`mf-flow pack <папка> [--out <шлях у work/>] [--overwrite]`:** лише для флоу, що проходить `mf-flow check`; пише `work/out/flow-<name>-<version>.zip` (усередині папка `<name>/` із SKILL.md, flow.md, example/, CHANGELOG.md; без `.DS_Store`, `node_modules`, посилань). Це власний zip-writer без залежностей, фіксована дата, тож однаковий флоу дає однакові байти. Пакет тієї самої версії повторно не перезаписується без `--overwrite`; запис лише в `work/`.
3. **Рев'ю:** дизайнер копіює zip у `_flows-pending/` на Drive (агент не пише на Drive); технічна людина розпаковує у `flows/` репо правил, запускає `mf-flow check`, читає флоу проти `safety.md`, ставить `status: approved`, дописує `CHANGELOG.md` правил (flow `<name>`: ...), комітить; команда оновлює плагін, `/motion-flow:whats-new` показує новий флоу.
4. **`mf-whatsnew`:** див. 4.19; перший запуск показує лише останні 3 релізи.
5. **Походження:** `skill-creator` (режим покращення: узагальнювати з відгуку, тримати інструкцію короткою, пояснювати чому; пакування з виключеннями службових файлів) і перевірки frontmatter з `validate_plugin.py` SDD. Код не копіювався.
