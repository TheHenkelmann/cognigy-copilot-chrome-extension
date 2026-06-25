(function ccpLoggerModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const DEBUG = Boolean(CCP.DEBUG);

  /**
   * @param {string} prefix
   */
  function createLogger(prefix) {
    return {
      debug: function (...args) {
        if (DEBUG) console.debug(prefix, ...args);
      },
      info: function (...args) {
        console.info(prefix, ...args);
      },
      warn: function (...args) {
        console.warn(prefix, ...args);
      },
      error: function (...args) {
        console.error(prefix, ...args);
      },
    };
  }

  CCP.createLogger = createLogger;
})();
