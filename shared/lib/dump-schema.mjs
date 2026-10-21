// Validator for the project dump written by lib/jsx/dump.jsx (schema in spec section 7).
// Returns a list of readable problems; an empty list means the dump is valid. Extra keys are allowed.

const LAYER_TYPES = ['shape', 'text', 'solid', 'precomp', 'footage', 'null', 'camera', 'light', 'other'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateDump(dump) {
  const problems = [];
  const need = (ok, where, message) => { if (!ok) problems.push(`${where}: ${message}`); return ok; };

  if (!need(isObject(dump), 'dump', 'must be an object')) return problems;

  if (need(isObject(dump.ae), 'ae', 'must be an object')) need(typeof dump.ae.version === 'string' && dump.ae.version !== '', 'ae.version', 'must be a non-empty string');
  if (need(isObject(dump.project), 'project', 'must be an object')) {
    need(dump.project.path === null || typeof dump.project.path === 'string', 'project.path', 'must be a string or null');
    need(Number.isInteger(dump.project.bitsPerChannel), 'project.bitsPerChannel', 'must be an integer');
  }

  if (need(Array.isArray(dump.footage), 'footage', 'must be an array')) {
    dump.footage.forEach((item, i) => {
      const at = `footage[${i}]`;
      if (!need(isObject(item), at, 'must be an object')) return;
      need(typeof item.name === 'string', `${at}.name`, 'must be a string');
      need(item.path === null || typeof item.path === 'string', `${at}.path`, 'must be a string or null');
      need(typeof item.missing === 'boolean', `${at}.missing`, 'must be a boolean');
    });
  }

  if (need(Array.isArray(dump.fonts), 'fonts', 'must be an array')) {
    dump.fonts.forEach((font, i) => need(typeof font === 'string', `fonts[${i}]`, 'must be a string'));
  }

  if (!need(Array.isArray(dump.comps), 'comps', 'must be an array')) return problems;
  const ids = new Set();
  dump.comps.forEach((comp, ci) => {
    const at = `comps[${ci}]`;
    if (!need(isObject(comp), at, 'must be an object')) return;
    need(Number.isInteger(comp.id), `${at}.id`, 'must be an integer');
    need(!ids.has(comp.id), `${at}.id`, `duplicate id ${comp.id}`);
    ids.add(comp.id);
    need(typeof comp.name === 'string' && comp.name !== '', `${at}.name`, 'must be a non-empty string');
    need(Number.isInteger(comp.width) && comp.width > 0, `${at}.width`, 'must be a positive integer');
    need(Number.isInteger(comp.height) && comp.height > 0, `${at}.height`, 'must be a positive integer');
    need(isNumber(comp.fps) && comp.fps > 0, `${at}.fps`, 'must be a positive number');
    need(isNumber(comp.duration) && comp.duration >= 0, `${at}.duration`, 'must be a number >= 0');
    if (!need(Array.isArray(comp.layers), `${at}.layers`, 'must be an array')) return;
    comp.layers.forEach((layer, li) => {
      const lat = `${at}.layers[${li}]`;
      if (!need(isObject(layer), lat, 'must be an object')) return;
      need(layer.index === li + 1, `${lat}.index`, `must be ${li + 1} (layers are listed in order, 1-based)`);
      need(typeof layer.name === 'string', `${lat}.name`, 'must be a string');
      need(LAYER_TYPES.includes(layer.type), `${lat}.type`, `must be one of ${LAYER_TYPES.join('|')}`);
      need(isNumber(layer.inPoint), `${lat}.inPoint`, 'must be a number');
      need(isNumber(layer.outPoint), `${lat}.outPoint`, 'must be a number');
      need(layer.parent === null || (Number.isInteger(layer.parent) && layer.parent >= 1 && layer.parent <= comp.layers.length && layer.parent !== layer.index), `${lat}.parent`, 'must be null or the index of another layer in the comp');
      need(typeof layer.enabled === 'boolean', `${lat}.enabled`, 'must be a boolean');
      need(typeof layer.locked === 'boolean', `${lat}.locked`, 'must be a boolean');
      if (need(isObject(layer.transform), `${lat}.transform`, 'must be an object')) {
        for (const key of ['position', 'scale', 'rotation', 'opacity']) {
          const v = layer.transform[key];
          need(v === null || isNumber(v) || (Array.isArray(v) && v.every(isNumber)), `${lat}.transform.${key}`, 'must be null, a number or an array of numbers');
        }
      }
      if (need(Array.isArray(layer.effects), `${lat}.effects`, 'must be an array')) {
        layer.effects.forEach((name, i) => need(typeof name === 'string', `${lat}.effects[${i}]`, 'must be a string'));
      }
      if (need(isObject(layer.expressions), `${lat}.expressions`, 'must be an object')) {
        for (const [key, text] of Object.entries(layer.expressions)) need(typeof text === 'string', `${lat}.expressions.${key}`, 'must be a string');
      }
      if (need(isObject(layer.keyframes), `${lat}.keyframes`, 'must be an object')) {
        for (const [key, list] of Object.entries(layer.keyframes)) {
          if (!need(Array.isArray(list), `${lat}.keyframes.${key}`, 'must be an array')) continue;
          list.forEach((frame, i) => {
            const fat = `${lat}.keyframes.${key}[${i}]`;
            need(isObject(frame) && isNumber(frame.t), `${fat}.t`, 'must be a number');
            need(isObject(frame) && 'v' in frame, `${fat}.v`, 'is required');
            need(isObject(frame) && typeof frame.ease === 'string', `${fat}.ease`, 'must be a string');
          });
        }
      }
    });
  });
  return problems;
}
