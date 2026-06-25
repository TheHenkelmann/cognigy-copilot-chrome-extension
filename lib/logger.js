/** @typedef {'debug' | 'info' | 'warn' | 'error'} LogLevel */

function isDebugEnabled() {
  return typeof globalThis !== "undefined" && globalThis.__CCP_DEBUG__ === true;
}

/**
 * @param {string} prefix
 */
export function createLogger(prefix) {
  return {
    /** @param {...unknown} args */
    debug(...args) {
      if (isDebugEnabled()) console.debug(prefix, ...args);
    },
    /** @param {...unknown} args */
    info(...args) {
      console.info(prefix, ...args);
    },
    /** @param {...unknown} args */
    warn(...args) {
      console.warn(prefix, ...args);
    },
    /** @param {...unknown} args */
    error(...args) {
      console.error(prefix, ...args);
    },
  };
}
