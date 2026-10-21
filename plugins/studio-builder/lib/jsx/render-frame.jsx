// motion-flow single-frame render for ExtendScript (After Effects). ES3 syntax only. Include after helpers.jsx.
// Params: { comp: "<comp name>", time: <seconds>, out: "<absolute .png path inside work/>" }.
// It does not change the project (read-only run); it only writes the PNG, and only inside work/.
// Uses CompItem.saveFrameToPng (After Effects 2020 and later). That call returns BEFORE the file is on disk
// (File.exists can still be false right after it), so this script does not check for the file: ae-render-frame
// waits for the PNG to appear and stop growing. [To verify on a real machine: T2.9]
mf.runIpc(function (input) {
    var params = input.params || {};
    var comp = mf.findComp(params.comp);
    var file;
    if (!comp) { throw new Error("Comp not found: " + params.comp); }
    if (typeof params.time !== "number" || params.time < 0 || params.time > comp.duration) {
        throw new Error("Time " + params.time + "s is outside the comp (0 to " + comp.duration + "s)");
    }
    file = mf.workFile(params.out);
    if (typeof comp.saveFrameToPng !== "function") {
        throw new Error("This After Effects version has no CompItem.saveFrameToPng. Use After Effects 2020 or newer.");
    }
    comp.saveFrameToPng(params.time, file);
    return { width: comp.width, height: comp.height, time: params.time };
}, { readOnly: true });
