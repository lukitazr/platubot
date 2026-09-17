// Polyfill para compatibilidad de Mongoose / BSON (v8.startupSnapshot) con Bun v1.3+
if (typeof globalThis.process?.getBuiltinModule === 'function') {
  const orig = globalThis.process.getBuiltinModule;
  globalThis.process.getBuiltinModule = function (name) {
    if (name === 'v8') return {};
    return orig.apply(this, arguments);
  };
}
