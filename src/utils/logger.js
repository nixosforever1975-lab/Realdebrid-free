function timestamp() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${timestamp()}][TFast]`, ...args);
}

function logWarn(...args) {
  console.warn(`[${timestamp()}][TFast][WARN]`, ...args);
}

function logError(...args) {
  console.error(`[${timestamp()}][TFast][ERROR]`, ...args);
}

module.exports = {
  log,
  logWarn,
  logError
};
