/**
 * sherpa-worker.js
 *
 * Generic Web Worker for offloading WASM inference (diarization, denoising,
 * offline ASR) off the main thread.  Loaded at runtime via a bootstrap
 * blob worker that calls importScripts(wasmBasePath + 'sherpa-worker.js').
 *
 * Message protocol:
 *   Main -> Worker:
 *     { type: 'init',    feature, wasmBasePath, config }
 *     { type: 'process', feature, requestId, payload }
 *     { type: 'release', feature }
 *
 *   Worker -> Main:
 *     { type: 'init-complete', feature, result }
 *     { type: 'init-error',   feature, error }
 *     { type: 'result',       feature, requestId, result }
 *     { type: 'process-error',feature, requestId, error }
 *     { type: 'released',     feature }
 */

// Fix IIFE global binding: feature JS files use
//   (function(global){...})(typeof window !== 'undefined' ? window : global)
// In a Worker both `window` and `global` are undefined, so the IIFE
// receives `undefined`.  Aliasing self.window = self makes them use `self`.
self.window = self;

let wasmReady = false;
let wasmBasePath = '';
const instances = {}; // { featureName: featureInstance }

// ---------------------------------------------------------------------------
// WASM bootstrap (once, on first init)
// ---------------------------------------------------------------------------
async function ensureWasm(basePath) {
  if (wasmReady) return;
  wasmBasePath = basePath;

  // The worker always runs from a blob: URL (bootstrap pattern), so Emscripten
  // can't resolve relative paths like "sherpa-onnx-wasm-combined.wasm".
  // Set locateFile so all file references use the absolute base path.
  self.Module = self.Module || {};
  self.Module.locateFile = function (file) {
    return basePath + file;
  };

  importScripts(basePath + 'sherpa-onnx-wasm-combined.js');

  // Wait for Emscripten runtime to initialise
  await new Promise(function (resolve) {
    if (self.Module && self.Module.calledRun) {
      resolve();
      return;
    }
    if (self.Module) {
      var prev = self.Module.onRuntimeInitialized;
      self.Module.onRuntimeInitialized = function () {
        if (prev) prev();
        resolve();
      };
    } else {
      // Poll as a last resort
      var poll = setInterval(function () {
        if (self.Module && self.Module.calledRun) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
    }
  });

  importScripts(basePath + 'sherpa-onnx-core.js');
  wasmReady = true;
}

// ---------------------------------------------------------------------------
// Feature script loader (idempotent per script name)
// ---------------------------------------------------------------------------
var loadedScripts = {};
function ensureScript(name) {
  if (loadedScripts[name]) return;
  importScripts(wasmBasePath + name);
  loadedScripts[name] = true;
}

// ---------------------------------------------------------------------------
// Emscripten FS helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  try {
    if (!self.Module.FS.analyzePath(dir).exists) {
      self.Module.FS.mkdir(dir);
    }
  } catch (_) {
    // already exists
  }
}

async function loadFileToFS(url, fsPath, debug) {
  var result = await self.SherpaOnnx.FileSystem.safeLoadFile(url, fsPath, debug);
  if (!result) throw new Error('Failed to load file: ' + url);
  return result.path;
}

// ---------------------------------------------------------------------------
// Feature handlers
// ---------------------------------------------------------------------------
var handlers = {
  // ---- Diarization --------------------------------------------------------
  diarization: {
    async init(config) {
      ensureScript('sherpa-onnx-speaker.js');
      var debug = config.debug ? 1 : 0;
      var modelDir = config.modelDir || '/wasm/speakers';
      var fetchBase = config.fetchBase || modelDir;

      var loadedModel = await self.SherpaOnnx.SpeakerDiarization.loadModel({
        segmentation: config.segmentationFile || (fetchBase + '/segmentation.onnx'),
        embedding: config.embeddingFile || (fetchBase + '/embedding.onnx'),
        modelDir: modelDir,
        debug: debug,
      });

      instances.diarization = self.SherpaOnnx.SpeakerDiarization.createDiarization(
        loadedModel,
        {
          numClusters: config.numClusters != null ? config.numClusters : -1,
          threshold: config.threshold != null ? config.threshold : 0.5,
          minDurationOn: config.minDurationOn,
          minDurationOff: config.minDurationOff,
          numThreads: 1,
          debug: debug,
        }
      );

      return { sampleRate: instances.diarization.sampleRate };
    },

    process(payload) {
      var inst = instances.diarization;
      if (!inst) throw new Error('Diarization not initialized in worker');

      if (payload.numClusters !== undefined || payload.threshold !== undefined) {
        inst.setConfig({
          clustering: {
            numClusters: payload.numClusters != null ? payload.numClusters : -1,
            threshold: payload.threshold != null ? payload.threshold : 0.5,
          },
        });
      }

      var segments = inst.process(payload.samples);
      return { segments: segments };
    },

    release() {
      if (instances.diarization) {
        try { instances.diarization.free(); } catch (_) {}
        instances.diarization = null;
      }
    },
  },

  // ---- Denoising ----------------------------------------------------------
  denoising: {
    async init(config) {
      ensureScript('sherpa-onnx-enhancement.js');
      var debug = config.debug ? 1 : 0;
      var modelDir = config.modelDir || '/wasm/enhancement';
      var fetchBase = config.fetchBase || modelDir;

      var loadedModel = await self.SherpaOnnx.SpeechEnhancement.loadModel({
        model: config.modelFile || (fetchBase + '/gtcrn.onnx'),
        modelDir: modelDir,
        debug: debug,
      });

      instances.denoising = self.SherpaOnnx.SpeechEnhancement.createDenoiser(
        loadedModel,
        { numThreads: 1, debug: debug }
      );

      return { sampleRate: instances.denoising.sampleRate };
    },

    process(payload) {
      var inst = instances.denoising;
      if (!inst) throw new Error('Denoiser not initialized in worker');

      var result = inst.run(payload.samples, payload.sampleRate);
      // Transfer the output samples back to main thread (zero-copy)
      return {
        result: { samples: result.samples, sampleRate: result.sampleRate },
        transferables: [result.samples.buffer],
      };
    },

    release() {
      if (instances.denoising) {
        try { instances.denoising.free(); } catch (_) {}
        instances.denoising = null;
      }
    },
  },

  // ---- Offline ASR --------------------------------------------------------
  'asr-offline': {
    async init(config) {
      ensureScript('sherpa-onnx-asr.js');
      var debug = config.debug ? 1 : 0;
      var modelDir = config.modelDir || '/wasm/asr';

      ensureDir(modelDir);

      // Load all model files into the worker's Emscripten FS.
      // Files marked `optional: true` are best-effort — a 404 means the
      // backend variant doesn't ship that sidecar (e.g. some Cohere
      // decoders have no .data sidecar) and init should continue. Match
      // the main-thread loader's behaviour in src/web/features/asr.ts.
      var files = config.files || [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        try {
          await loadFileToFS(f.url, f.fsPath, debug);
        } catch (err) {
          if (f.optional) {
            if (debug) console.log('[sherpa-worker] optional file missing, continuing: ' + f.url);
            continue;
          }
          throw err;
        }
      }

      // Create recognizer with the pre-computed config from the main thread
      var recognizer = new self.OfflineRecognizer(
        config.recognizerConfig,
        self.Module
      );

      if (!recognizer || !recognizer.handle) {
        throw new Error('Failed to create offline recognizer in worker');
      }

      instances['asr-offline'] = recognizer;
      return { sampleRate: config.recognizerConfig.featConfig.sampleRate };
    },

    process(payload) {
      var recognizer = instances['asr-offline'];
      if (!recognizer) throw new Error('Offline ASR not initialized in worker');

      var stream = recognizer.createStream();
      try {
        stream.acceptWaveform(payload.sampleRate, payload.samples);
        recognizer.decode(stream);
        var result = recognizer.getResult(stream);
        return { text: result.text };
      } finally {
        stream.free();
      }
    },

    release() {
      if (instances['asr-offline']) {
        try { instances['asr-offline'].free(); } catch (_) {}
        instances['asr-offline'] = null;
      }
    },
  },
};

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------
self.onmessage = async function (e) {
  var msg = e.data;
  var feature = msg.feature;

  if (msg.type === 'init') {
    try {
      await ensureWasm(msg.wasmBasePath);
      var handler = handlers[feature];
      if (!handler) throw new Error('Unknown feature: ' + feature);
      var result = await handler.init(msg.config);
      self.postMessage({ type: 'init-complete', feature: feature, result: result });
    } catch (err) {
      self.postMessage({
        type: 'init-error',
        feature: feature,
        error: err.message || String(err),
      });
    }
    return;
  }

  if (msg.type === 'process') {
    try {
      var handler = handlers[feature];
      if (!handler) throw new Error('Unknown feature: ' + feature);
      var out = handler.process(msg.payload);

      // Handlers may return { result, transferables } for zero-copy transfer,
      // or a plain object (treated as the result with no transferables).
      var result = (out && out.result !== undefined && out.transferables) ? out.result : out;
      var transferables = (out && out.transferables) ? out.transferables : [];

      self.postMessage(
        { type: 'result', feature: feature, requestId: msg.requestId, result: result },
        transferables
      );
    } catch (err) {
      self.postMessage({
        type: 'process-error',
        feature: feature,
        requestId: msg.requestId,
        error: err.message || String(err),
      });
    }
    return;
  }

  if (msg.type === 'release') {
    try {
      var handler = handlers[feature];
      if (handler) handler.release();
    } catch (_) {}
    self.postMessage({ type: 'released', feature: feature });
    return;
  }
};
