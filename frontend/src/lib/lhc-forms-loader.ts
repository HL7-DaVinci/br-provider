/**
 * Lazy loader for LHC-Forms scripts and CSS.
 * Scripts are only loaded when the DTR form route is visited.
 */

const ELEMENT_READY_TIMEOUT_MS = 15000;

let loadPromise: Promise<void> | null = null;
const scriptPromises = new Map<string, Promise<void>>();

export function loadLhcForms(): Promise<void> {
  if (window.LForms?.Util && customElements.get("wc-lhc-form")) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    loadStylesheet("/lforms/styles.css");
    await loadScript("/lforms/zone.min.js");
    await loadScript("/lforms/runtime.js");
    await loadScript("/lforms/polyfills.js");
    await loadScript("/lforms/main.js");
    await loadScript("/lforms/lformsFHIR.min.js");
    await waitForFormElement();
  })().catch((err) => {
    // Drop the cached promise so a transient failure does not permanently
    // break form loading until a page refresh.
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

/**
 * The Angular bootstrap that registers wc-lhc-form is asynchronous and can
 * fail after main.js has loaded. Using the element before it is registered
 * makes addFormToPage hang forever, so wait for it with a bounded timeout.
 */
function waitForFormElement(): Promise<void> {
  if (customElements.get("wc-lhc-form")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          "The LHC-Forms component failed to initialize. Reload the page to try again.",
        ),
      );
    }, ELEMENT_READY_TIMEOUT_MS);
    customElements.whenDefined("wc-lhc-form").then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function loadScript(src: string): Promise<void> {
  let promise = scriptPromises.get(src);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => {
        // Remove the failed tag and forget it so a retry re-adds the script.
        // Already-loaded scripts keep their resolved promise and are never
        // re-executed on retry.
        scriptPromises.delete(src);
        script.remove();
        reject(new Error(`Failed to load script: ${src}`));
      };
      document.head.appendChild(script);
    });
    scriptPromises.set(src, promise);
  }
  return promise;
}

function loadStylesheet(href: string): void {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  // Insert before existing styles so app CSS overrides LHC-Forms defaults
  const firstStylesheet = document.querySelector(
    'link[rel="stylesheet"], style',
  );
  if (firstStylesheet) {
    document.head.insertBefore(link, firstStylesheet);
  } else {
    document.head.appendChild(link);
  }
}
