// deps.json: the tools the plugins can need, with how to check and install them.

const DETECTORS = ['after-effects'];

/** Validates the shape of deps.json and returns the entries. Throws Error with a readable message. */
export function parseDeps(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`deps.json is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(data)) throw new Error('deps.json must be an array of dependency objects');
  const seen = new Set();
  data.forEach((dep, i) => {
    const at = `deps.json[${i}]`;
    if (!dep || typeof dep !== 'object') throw new Error(`${at} must be an object`);
    if (typeof dep.name !== 'string' || !dep.name) throw new Error(`${at}.name is required`);
    if (seen.has(dep.name)) throw new Error(`${at}: duplicate name "${dep.name}"`);
    seen.add(dep.name);
    if (dep.check !== null && typeof dep.check !== 'string') throw new Error(`${at}.check must be a command string or null`);
    if (dep.check !== null && typeof dep.version_regex === 'string') {
      try { new RegExp(dep.version_regex); } catch (e) { throw new Error(`${at}.version_regex is not a valid regex: ${e.message}`); }
    }
    if (dep.min_version != null && !/^\d+(\.\d+)*$/.test(dep.min_version)) throw new Error(`${at}.min_version must look like 1.2.3`);
    if (dep.detect !== undefined && !DETECTORS.includes(dep.detect)) throw new Error(`${at}.detect must be one of: ${DETECTORS.join(', ')}`);
    if (!dep.install || typeof dep.install.macos !== 'string' || typeof dep.install.windows !== 'string') {
      throw new Error(`${at}.install needs "macos" and "windows" strings`);
    }
    if (!Array.isArray(dep.required_by)) throw new Error(`${at}.required_by must be an array`);
  });
  return data;
}
