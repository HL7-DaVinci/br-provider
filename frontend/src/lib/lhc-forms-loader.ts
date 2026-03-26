/**
 * Lazy loader for LHC-Forms scripts and CSS.
 * Scripts are only loaded when the DTR form route is visited.
 */

let loadPromise: Promise<void> | null = null;

export function loadLhcForms(): Promise<void> {
  if (window.LForms?.Util) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    loadStylesheet("/lforms/styles.css");
    await loadScript("/lforms/zone.min.js");
    await loadScript("/lforms/runtime.js");
    await loadScript("/lforms/polyfills.js");
    await loadScript("/lforms/main.js");
    await loadScript("/lforms/lformsFHIR.min.js");
  })();

  return loadPromise;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
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
