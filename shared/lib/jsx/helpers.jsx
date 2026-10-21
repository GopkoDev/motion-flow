// motion-flow helpers for ExtendScript (After Effects). ES3 syntax only: no let/const, no arrow functions,
// no Array.forEach/map/filter/indexOf, no JSON object, no trailing commas.
//
// How a run works (set up by bin/ae-run, which writes a small wrapper script):
//   $.global.MF_IPC = { inPath: "...in.json", outPath: "...out.json", undoName: "step name", save: true };
//   #include "helpers.jsx"
//   #include "<the script to run>"      <- ends with mf.runIpc(function (input) { ...; return result; });
//
// mf.runIpc reads the .in.json, makes sure the right project is open, runs the function inside one undo group,
// saves the project copy, and ALWAYS writes the .out.json: { ok, result, error, durationMs }.
// Nothing here ever shows a dialog.

var mf = (function () {
    var api = {};

    // ---------- JSON (After Effects has no built-in JSON object) ----------

    function pad4(hex) {
        while (hex.length < 4) { hex = "0" + hex; }
        return hex;
    }

    function quote(text) {
        var out = '"';
        var i;
        var ch;
        var code;
        for (i = 0; i < text.length; i++) {
            ch = text.charAt(i);
            code = text.charCodeAt(i);
            if (ch === '"') { out += '\\"'; }
            else if (ch === "\\") { out += "\\\\"; }
            else if (ch === "\n") { out += "\\n"; }
            else if (ch === "\r") { out += "\\r"; }
            else if (ch === "\t") { out += "\\t"; }
            else if (code < 32 || code === 0x2028 || code === 0x2029) { out += "\\u" + pad4(code.toString(16)); }
            else { out += ch; }
        }
        return out + '"';
    }

    function isArray(value) {
        return Object.prototype.toString.call(value) === "[object Array]";
    }

    /** Serializes numbers, strings, booleans, null, arrays and plain objects. undefined and functions become null. */
    function toJSON(value, indent, level) {
        var type = typeof value;
        var parts = [];
        var i;
        var key;
        var nl = indent ? "\n" : "";
        var inner = indent ? new Array((level || 0) + 2).join(indent) : "";
        var outer = indent ? new Array((level || 0) + 1).join(indent) : "";
        if (value === null || value === undefined || type === "function") { return "null"; }
        if (type === "number") { return isFinite(value) ? String(value) : "null"; }
        if (type === "boolean") { return value ? "true" : "false"; }
        if (type === "string") { return quote(value); }
        if (isArray(value)) {
            if (value.length === 0) { return "[]"; }
            for (i = 0; i < value.length; i++) { parts.push(inner + toJSON(value[i], indent, (level || 0) + 1)); }
            return "[" + nl + parts.join("," + nl) + nl + outer + "]";
        }
        for (key in value) {
            if (value.hasOwnProperty(key) && value[key] !== undefined && typeof value[key] !== "function") {
                parts.push(inner + quote(key) + ":" + (indent ? " " : "") + toJSON(value[key], indent, (level || 0) + 1));
            }
        }
        if (parts.length === 0) { return "{}"; }
        return "{" + nl + parts.join("," + nl) + nl + outer + "}";
    }

    /** Strict JSON parser (no eval). Throws an Error with the position on bad input. */
    function parseJSON(text) {
        var pos = 0;

        function fail(message) { throw new Error("JSON: " + message + " at position " + pos); }
        function skip() {
            while (pos < text.length && " \t\r\n".indexOf(text.charAt(pos)) !== -1) { pos++; }
        }
        function expect(word) {
            if (text.substr(pos, word.length) !== word) { fail("expected " + word); }
            pos += word.length;
        }
        function readString() {
            var out = "";
            var ch;
            var esc;
            pos++; // opening quote
            while (pos < text.length) {
                ch = text.charAt(pos++);
                if (ch === '"') { return out; }
                if (ch === "\\") {
                    esc = text.charAt(pos++);
                    if (esc === "n") { out += "\n"; }
                    else if (esc === "r") { out += "\r"; }
                    else if (esc === "t") { out += "\t"; }
                    else if (esc === "b") { out += "\b"; }
                    else if (esc === "f") { out += "\f"; }
                    else if (esc === "u") {
                        if (!/^[0-9a-fA-F]{4}$/.test(text.substr(pos, 4))) { fail("bad \\u escape"); }
                        out += String.fromCharCode(parseInt(text.substr(pos, 4), 16));
                        pos += 4;
                    } else if (esc === '"' || esc === "\\" || esc === "/") { out += esc; }
                    else { fail("bad escape"); }
                } else {
                    out += ch;
                }
            }
            return fail("unterminated string");
        }
        function readValue() {
            var ch;
            var list;
            var obj;
            var key;
            var match;
            skip();
            ch = text.charAt(pos);
            if (ch === "{") {
                obj = {};
                pos++;
                skip();
                if (text.charAt(pos) === "}") { pos++; return obj; }
                for (;;) {
                    skip();
                    if (text.charAt(pos) !== '"') { fail("expected a key"); }
                    key = readString();
                    skip();
                    if (text.charAt(pos++) !== ":") { fail("expected :"); }
                    obj[key] = readValue();
                    skip();
                    ch = text.charAt(pos++);
                    if (ch === "}") { return obj; }
                    if (ch !== ",") { fail("expected , or }"); }
                }
            }
            if (ch === "[") {
                list = [];
                pos++;
                skip();
                if (text.charAt(pos) === "]") { pos++; return list; }
                for (;;) {
                    list.push(readValue());
                    skip();
                    ch = text.charAt(pos++);
                    if (ch === "]") { return list; }
                    if (ch !== ",") { fail("expected , or ]"); }
                }
            }
            if (ch === '"') { return readString(); }
            if (ch === "t") { expect("true"); return true; }
            if (ch === "f") { expect("false"); return false; }
            if (ch === "n") { expect("null"); return null; }
            match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.substr(pos));
            if (!match) { fail("unexpected character"); }
            pos += match[0].length;
            return parseFloat(match[0]);
        }

        var result = readValue();
        skip();
        if (pos !== text.length) { fail("extra text after the value"); }
        return result;
    }

    // ---------- files ----------

    function readText(path) {
        var file = new File(path);
        var text;
        if (!file.exists) { throw new Error("File not found: " + path); }
        file.encoding = "UTF-8";
        if (!file.open("r")) { throw new Error("Cannot open for reading: " + path); }
        try { text = file.read(); } finally { file.close(); }
        return text;
    }

    /** Writes via a temporary file and a rename, so a waiting process never sees half a file. */
    function writeText(path, text) {
        var target = new File(path);
        var tmp = new File(path + ".tmp");
        var name = target.name;
        if (!target.parent.exists) { throw new Error("Folder does not exist: " + target.parent.fsName); }
        tmp.encoding = "UTF-8";
        if (!tmp.open("w")) {
            throw new Error('Cannot write "' + path + '". In After Effects enable Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".');
        }
        try { tmp.write(text); } finally { tmp.close(); }
        if (target.exists) { target.remove(); }
        if (!tmp.rename(name)) { throw new Error("Cannot rename the temporary result file to " + name); }
    }

    // ---------- finding things ----------

    /** All layers of a comp with this exact name (1-based AE indexes can shift, names are the stable handle). */
    function findLayers(comp, name) {
        var found = [];
        var i;
        for (i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === name) { found.push(comp.layer(i)); }
        }
        return found;
    }

    /** The one layer with this name, or null. Throws when the name is ambiguous, so a script never edits the wrong layer. */
    function findLayer(comp, name) {
        var found = findLayers(comp, name);
        if (found.length > 1) { throw new Error('More than one layer is named "' + name + '" in comp "' + comp.name + '"'); }
        return found.length === 1 ? found[0] : null;
    }

    function findComp(name) {
        var found = [];
        var i;
        var item;
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if (item instanceof CompItem && item.name === name) { found.push(item); }
        }
        if (found.length > 1) { throw new Error('More than one comp is named "' + name + '"'); }
        return found.length === 1 ? found[0] : null;
    }

    // ---------- files inside work/ only ----------

    function slashes(path) {
        return String(path).replace(/\\/g, "/");
    }

    /** The path as a normalized string, only when it lies inside the work folder given by MF_IPC.workDir. */
    function pathInsideWork(path) {
        var work = $.global.MF_IPC && $.global.MF_IPC.workDir ? slashes($.global.MF_IPC.workDir).replace(/\/+$/, "") : "";
        var target;
        var parts;
        var i;
        if (work === "") { throw new Error("The work folder is not known to the script (MF_IPC.workDir)."); }
        target = slashes(new File(String(path)).fsName);
        parts = target.split("/");
        for (i = 0; i < parts.length; i++) {
            if (parts[i] === "..") { throw new Error("Path with .. is not allowed: " + path); }
        }
        if (target.toLowerCase().indexOf(work.toLowerCase() + "/") !== 0) {
            throw new Error("Path is outside the work folder: " + path);
        }
        return target;
    }

    /** A File that is guaranteed to lie inside work/ (scripts may not use File directly). */
    function workFile(path) {
        return new File(pathInsideWork(path));
    }

    function workFolder(path) {
        return new Folder(pathInsideWork(path));
    }

    // ---------- project and dialogs ----------

    function sameFile(a, b) {
        return new File(a).fsName === new File(b).fsName;
    }

    /**
     * Makes sure the wanted project is the open one. A different open project is closed WITHOUT saving only when
     * it is a saved file and After Effects says it has no unsaved changes (app.project.dirty === false): then
     * nothing can be lost. An untitled project, one with unsaved changes, or one whose state cannot be read
     * stops the run with a clear error. (Closing a dirty project without DO_NOT_SAVE_CHANGES would raise a
     * "Save changes?" dialog that blocks scripting, so it is never attempted.)
     */
    function ensureProject(path) {
        var file = new File(path);
        var current = app.project;
        var why;
        if (!file.exists) { throw new Error("Project file not found: " + path); }
        if (current && current.file && sameFile(current.file.fsName, file.fsName)) { return current; }
        if (current && (current.file || current.numItems > 0)) {
            if (!current.file) {
                why = "(unsaved) has never been saved";
            } else if (current.dirty === true) {
                why = "(" + current.file.fsName + ") has unsaved changes";
            } else if (current.dirty !== false) {
                why = "(" + current.file.fsName + ") and its unsaved state cannot be read";
            }
            if (why) {
                throw new Error("Another project is open in After Effects " + why
                    + ". Save and close it yourself; motion-flow switches away only from a saved project with no unsaved changes.");
            }
            current.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        }
        app.open(file);
        return app.project;
    }

    function quietDialogs() {
        try {
            if (typeof app.beginSuppressDialogs === "function") { app.beginSuppressDialogs(); return true; }
        } catch (e) { /* older versions: nothing to suppress */ }
        return false;
    }

    function endQuietDialogs(started) {
        try {
            if (started && typeof app.endSuppressDialogs === "function") { app.endSuppressDialogs(false); }
        } catch (e) { /* ignore */ }
    }

    // ---------- undo ----------

    /** Runs fn inside one undo group, closing the group even when fn throws. */
    function undoGroup(name, fn) {
        app.beginUndoGroup(name);
        try { return fn(); } finally { app.endUndoGroup(); }
    }

    // ---------- errors and the run wrapper ----------

    function describeError(e) {
        var text = e && e.message ? String(e.message) : String(e);
        var line = e && e.line ? " (line " + e.line + ")" : "";
        return text + line;
    }

    /**
     * Runs fn(input, mf) and writes the result file. opts (overrides $.global.MF_IPC):
     *   inPath, outPath, undoName, save (save the project after success), readOnly (no undo group, no save).
     */
    function runIpc(fn, overrides) {
        var opts = {};
        var key;
        var start = new Date().getTime();
        var out = { ok: false, result: null, error: null, durationMs: 0 };
        var input = {};
        var quiet = false;
        var base = $.global.MF_IPC || {};

        for (key in base) { if (base.hasOwnProperty(key)) { opts[key] = base[key]; } }
        if (overrides) { for (key in overrides) { if (overrides.hasOwnProperty(key)) { opts[key] = overrides[key]; } } }
        if (!opts.outPath) { throw new Error("mf.runIpc: no outPath (MF_IPC is not set)"); }

        try {
            quiet = quietDialogs();
            if (opts.inPath) { input = parseJSON(readText(opts.inPath)); }
            if (input.project) { ensureProject(input.project); }
            if (opts.readOnly) {
                out.result = fn(input, api);
            } else {
                out.result = undoGroup(opts.undoName || input.undo || "motion-flow", function () { return fn(input, api); });
                if (opts.save && app.project.file) { app.project.save(); }
            }
            out.ok = true;
        } catch (e) {
            out.error = describeError(e);
        }
        endQuietDialogs(quiet);
        out.durationMs = new Date().getTime() - start;
        writeResult(opts.outPath, out);
        return out;
    }

    /**
     * Writes the result file. If the result cannot be turned into JSON (for example it contains a circular
     * reference) a plain failure is written instead, so the caller gets an answer rather than a timeout.
     */
    function writeResult(outPath, out) {
        var text;
        try {
            text = toJSON(out);
        } catch (serializeError) {
            text = toJSON({ ok: false, result: null, error: "The script result could not be turned into JSON: " + describeError(serializeError), durationMs: out.durationMs });
        }
        try {
            writeText(outPath, text);
        } catch (writeError) {
            // Last resort: the caller will see a timeout instead of a result, and this line in the ExtendScript log.
            $.writeln("motion-flow: could not write " + outPath + ": " + describeError(writeError));
        }
    }

    /**
     * Reports a failure from outside runIpc (a syntax error, or a script that never called mf.runIpc).
     * Does nothing when a result file already exists.
     */
    function failIpc(message) {
        var ipc = $.global.MF_IPC || {};
        if (!ipc.outPath || new File(ipc.outPath).exists) { return; }
        writeResult(ipc.outPath, { ok: false, result: null, error: message, durationMs: 0 });
    }

    api.toJSON = toJSON;
    api.parseJSON = parseJSON;
    api.readText = readText;
    api.writeText = writeText;
    api.findLayers = findLayers;
    api.findLayer = findLayer;
    api.findComp = findComp;
    api.workFile = workFile;
    api.workFolder = workFolder;
    api.ensureProject = ensureProject;
    api.undoGroup = undoGroup;
    api.describeError = describeError;
    api.runIpc = runIpc;
    api.failIpc = failIpc;
    return api;
}());
