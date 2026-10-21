// motion-flow ping for ExtendScript: reports the After Effects version and the open project. Read-only. ES3 syntax only.
// Include after helpers.jsx.
mf.runIpc(function () {
    var hasProject = !!(app.project && (app.project.file || app.project.numItems > 0));
    return {
        aeVersion: app.version,
        projectOpen: hasProject,
        projectPath: app.project && app.project.file ? app.project.file.fsName : null
    };
}, { readOnly: true });
