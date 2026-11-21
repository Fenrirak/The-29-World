/* Load a versioned classic script once, and allow retries after network errors. */
const t29PendingScripts = new Map();

function t29LoadScript(src) {
  if (!t29PendingScripts.has(src)) {
    t29PendingScripts.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        t29PendingScripts.delete(src);
        reject(new Error("The download was interrupted. Please try again."));
      };
      document.head.appendChild(script);
    }));
  }
  return t29PendingScripts.get(src);
}
