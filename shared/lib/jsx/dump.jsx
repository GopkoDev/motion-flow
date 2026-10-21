// motion-flow project dump for ExtendScript (After Effects). ES3 syntax only.
// Include after helpers.jsx. Reads the open project and writes the JSON described in spec section 7:
//   { ae, project, footage[], fonts[], comps[] { layers[] } }
// It never changes the project: it runs read-only (no undo group, no save).
//
// Property keys in "expressions" and "keyframes" are dotted camelCase paths from the layer, for example
// "transform.position", "transform.opacity", "effects.gaussianBlur.blurriness", "contents.group1.rectPath1.size".
// Options come in input.params, all optional: { "keyframes": true, "expressions": true, "maxKeyframes": 200 }.

(function () {
    var PROPERTY_TYPE_PROPERTY = PropertyType.PROPERTY;

    function camel(name) {
        var words = String(name).replace(/[^A-Za-z0-9 ]/g, " ").split(" ");
        var out = "";
        var i;
        var word;
        for (i = 0; i < words.length; i++) {
            word = words[i];
            if (word === "") { continue; }
            out += (out === "" ? word.charAt(0).toLowerCase() : word.charAt(0).toUpperCase()) + word.substr(1);
        }
        return out;
    }

    function safe(fn, fallback) {
        try { return fn(); } catch (e) { return fallback; }
    }

    function plainValue(value) {
        var out = [];
        var i;
        if (value === null || value === undefined) { return null; }
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") { return value; }
        if (Object.prototype.toString.call(value) === "[object Array]") {
            for (i = 0; i < value.length; i++) { out.push(plainValue(value[i])); }
            return out;
        }
        return String(value); // shapes, text documents, colors etc. are not expanded
    }

    function interpolationName(type) {
        if (type === KeyframeInterpolationType.LINEAR) { return "LINEAR"; }
        if (type === KeyframeInterpolationType.BEZIER) { return "BEZIER"; }
        if (type === KeyframeInterpolationType.HOLD) { return "HOLD"; }
        return "OTHER";
    }

    function layerKind(layer) {
        var source;
        if (layer instanceof ShapeLayer) { return "shape"; }
        if (layer instanceof TextLayer) { return "text"; }
        if (layer instanceof CameraLayer) { return "camera"; }
        if (layer instanceof LightLayer) { return "light"; }
        if (layer.nullLayer) { return "null"; }
        source = layer.source;
        if (source instanceof CompItem) { return "precomp"; }
        if (source instanceof FootageItem) {
            if (source.mainSource instanceof SolidSource) { return "solid"; }
            return "footage";
        }
        return "other";
    }

    /** Walks every property below `group`, collecting expressions and keyframes under dotted keys. */
    function walk(group, prefix, options, into) {
        var i;
        var j;
        var prop;
        var key;
        var keys;
        var count;
        var entry;
        for (i = 1; i <= group.numProperties; i++) {
            prop = group.property(i);
            key = prefix + (prefix === "" ? "" : ".") + camel(prop.name === "" ? prop.matchName : prop.name);
            if (prop.propertyType === PROPERTY_TYPE_PROPERTY) {
                if (options.expressions && prop.canSetExpression && prop.expressionEnabled && prop.expression !== "") {
                    into.expressions[key] = prop.expression;
                }
                if (options.keyframes && prop.numKeys > 0) {
                    keys = [];
                    count = Math.min(prop.numKeys, options.maxKeyframes);
                    for (j = 1; j <= count; j++) {
                        entry = {
                            t: prop.keyTime(j),
                            v: plainValue(safe(function () { return prop.keyValue(j); }, null)),
                            ease: "in:" + interpolationName(prop.keyInInterpolationType(j)) + ",out:" + interpolationName(prop.keyOutInterpolationType(j))
                        };
                        keys.push(entry);
                    }
                    into.keyframes[key] = keys;
                }
            } else {
                walk(prop, key, options, into);
            }
        }
    }

    function transformValue(layer, matchName) {
        return plainValue(safe(function () { return layer.property("ADBE Transform Group").property(matchName).value; }, null));
    }

    function dumpLayer(layer, options) {
        var collected = { expressions: {}, keyframes: {} };
        var effects = safe(function () { return layer.property("ADBE Effect Parade"); }, null);
        var effectNames = [];
        var i;
        if (effects) {
            for (i = 1; i <= effects.numProperties; i++) { effectNames.push(effects.property(i).name); }
        }
        // Walk all property groups of the layer; effect parameters are keyed under "effects.<name>.<param>".
        for (i = 1; i <= layer.numProperties; i++) {
            walk(layer.property(i), camel(layer.property(i).name), options, collected);
        }
        return {
            index: layer.index,
            name: layer.name,
            type: layerKind(layer),
            inPoint: layer.inPoint,
            outPoint: layer.outPoint,
            parent: layer.parent ? layer.parent.index : null,
            enabled: layer.enabled,
            locked: layer.locked,
            adjustment: safe(function () { return layer.adjustmentLayer === true; }, false),
            sourceMissing: safe(function () { return !!(layer.source && layer.source.footageMissing); }, false),
            transform: {
                position: transformValue(layer, "ADBE Position"),
                scale: transformValue(layer, "ADBE Scale"),
                rotation: transformValue(layer, "ADBE Rotate Z"),
                opacity: transformValue(layer, "ADBE Opacity")
            },
            effects: effectNames,
            expressions: collected.expressions,
            keyframes: collected.keyframes
        };
    }

    function dumpComp(comp, options) {
        var layers = [];
        var i;
        for (i = 1; i <= comp.numLayers; i++) { layers.push(dumpLayer(comp.layer(i), options)); }
        return {
            id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            fps: comp.frameRate,
            duration: comp.duration,
            layers: layers
        };
    }

    function collectFootageAndFonts() {
        var footage = [];
        var fonts = [];
        var seen = {};
        var i;
        var j;
        var item;
        var layer;
        var font;
        var doc;
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if (item instanceof FootageItem && !(item.mainSource instanceof SolidSource)) {
                footage.push({
                    name: item.name,
                    path: item.file ? item.file.fsName : null,
                    missing: item.footageMissing === true
                });
            }
            if (item instanceof CompItem) {
                for (j = 1; j <= item.numLayers; j++) {
                    layer = item.layer(j);
                    if (layer instanceof TextLayer) {
                        doc = safe(function () { return layer.property("ADBE Text Properties").property("ADBE Text Document").value; }, null);
                        font = doc ? safe(function () { return doc.font; }, null) : null;
                        if (font && !seen[font]) { seen[font] = true; fonts.push(font); }
                    }
                }
            }
        }
        return { footage: footage, fonts: fonts };
    }

    mf.dumpProject = function (input) {
        var params = (input && input.params) ? input.params : {};
        var options = {
            keyframes: params.keyframes !== false,
            expressions: params.expressions !== false,
            maxKeyframes: params.maxKeyframes ? params.maxKeyframes : 200
        };
        var comps = [];
        var i;
        var item;
        var extra = collectFootageAndFonts();
        for (i = 1; i <= app.project.numItems; i++) {
            item = app.project.item(i);
            if (item instanceof CompItem) { comps.push(dumpComp(item, options)); }
        }
        return {
            ae: { version: app.version },
            project: { path: app.project.file ? app.project.file.fsName : null, bitsPerChannel: app.project.bitsPerChannel },
            footage: extra.footage,
            fonts: extra.fonts,
            comps: comps
        };
    };

    mf.runIpc(function (input) { return mf.dumpProject(input); }, { readOnly: true });
}());
