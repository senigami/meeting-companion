// Loads the vendored onnxruntime-web and @ricky0123/vad-web UMD bundles once, idempotently, and
// resolves with the `vad` global they create. Both are script tags rather than ES modules (that
// is how they are vendored), so this is DOM-only: it injects <script> tags onto the document and
// waits on their load/error events instead of import()-ing anything.
//
// Load order matters: ort must be present and configured (wasmPaths, numThreads) BEFORE the vad
// bundle loads, because vad's wasm backend selection happens at script-evaluation time.
let loadPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

export function loadVad() {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    await loadScript('/vendor/ort/ort.wasm.min.js');
    if (typeof ort === 'undefined') {
      throw new Error('VAD loader: ort.wasm.min.js loaded but did not define window.ort');
    }
    ort.env.wasm.wasmPaths = '/vendor/ort/';
    ort.env.wasm.numThreads = 1;

    await loadScript('/vendor/vad/bundle.min.js');
    if (typeof vad === 'undefined') {
      throw new Error('VAD loader: bundle.min.js loaded but did not define window.vad');
    }
    return vad;
  })().catch((error) => {
    // Do not cache a failed load -- a transient network blip should not permanently break every
    // future attempt to start transcription in this tab.
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}
