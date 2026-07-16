(function ccpSnackbarFormatModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});

  function formatApiError(err) {
    const raw = err instanceof Error ? err.message : String(err);
    const apiMatch = raw.match(/^API\s+(\d{3}):\s*([\s\S]*)$/);
    if (apiMatch) {
      return { title: "Request failed (" + apiMatch[1] + ")", body: apiMatch[2].trim() };
    }
    const taskMatch = raw.match(/^Task\s+(\w+)(?::\s*([\s\S]*))?$/);
    if (taskMatch) {
      return {
        title: "Task " + taskMatch[1],
        body: (taskMatch[2] && taskMatch[2].trim()) || "",
      };
    }
    const match = raw.match(/^(\d{3})\s+([\s\S]*)$/);
    if (match) {
      const status = match[1];
      const body = match[2].trim();
      return { title: "Request failed (" + status + ")", body: body };
    }
    if (raw.startsWith("Error: ")) {
      const inner = raw.slice(7);
      const innerMatch = inner.match(/^(\d{3})\s+([\s\S]*)$/);
      if (innerMatch) {
        return { title: "Request failed (" + innerMatch[1] + ")", body: innerMatch[2].trim() };
      }
      return { title: "Error", body: inner };
    }
    return { title: raw, body: "" };
  }

  function pushApiError(showError, err) {
    const formatted = formatApiError(err);
    showError(formatted.title, formatted.body || undefined);
  }

  CCP.formatApiError = formatApiError;
  CCP.pushApiError = pushApiError;
})();
