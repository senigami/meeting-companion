// Frame-level voice activity detection for the OpenAI transcription path (issues #23/#24). An RMS
// gate alone is known not to work: real room noise sits above any level threshold that doesn't
// also clip real speech, and a pure tone (issue #23's exact reproduction) has speech-level RMS
// while carrying no words at all. This module classifies on spectral SHAPE as well as energy, and
// is pure/DOM-free/dependency-free so it can be unit-tested without any Web Audio mocking.

// Geometric mean / arithmetic mean of a magnitude spectrum, 0..1. Steady noise is spectrally flat
// (all bins carry similar energy, so this sits near 1); voiced speech is peaky (energy concentrated
// in a handful of harmonic bins, so this sits near 0). Guarded against zeros/degenerate input --
// "can't tell" reads as flat/noise-like (1), which is the fail-closed direction for this one metric
// alone (the RMS gate and peak-count check below cover the rest of the decision).
export function spectralFlatness(magnitudes) {
  if (!magnitudes || !magnitudes.length) return 1;
  let logSum = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < magnitudes.length; i += 1) {
    const value = magnitudes[i];
    if (!Number.isFinite(value) || value < 0) continue;
    const safe = value > 1e-12 ? value : 1e-12;
    logSum += Math.log(safe);
    sum += safe;
    count += 1;
  }
  if (!count || sum <= 0) return 1;
  const geometricMean = Math.exp(logSum / count);
  const arithmeticMean = sum / count;
  if (arithmeticMean <= 0) return 1;
  return geometricMean / arithmeticMean;
}

// Fraction of adjacent-sample sign changes, 0..1.
export function zeroCrossingRate(samples) {
  if (!samples || samples.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const prevNonNegative = samples[i - 1] >= 0;
    const curNonNegative = samples[i] >= 0;
    if (prevNonNegative !== curNonNegative) crossings += 1;
  }
  return crossings / (samples.length - 1);
}

// Count of local maxima in the magnitude spectrum at or above `relThreshold` of the spectrum's
// peak. NOT part of the RMS/flatness/zcr trio named in the brief -- added because spectral
// flatness alone cannot tell a single pure tone from a handful of harmonically-related tones: both
// concentrate energy into a few bins and crush the geometric mean identically. A vowel's
// fundamental-plus-harmonics produces several distinct peaks; a pure tone (issue #23's exact
// reproduction case, and RMS-gate-defeating on its own) produces exactly one. Not exported as part
// of the documented decision inputs, but exported here for direct unit testing.
export function spectralPeakCount(magnitudes, relThreshold = 0.2) {
  if (!magnitudes || magnitudes.length < 3) return 0;
  let max = 0;
  for (let i = 0; i < magnitudes.length; i += 1) {
    if (magnitudes[i] > max) max = magnitudes[i];
  }
  if (max <= 0) return 0;
  const threshold = max * relThreshold;
  let count = 0;
  for (let i = 1; i < magnitudes.length - 1; i += 1) {
    if (magnitudes[i] >= threshold && magnitudes[i] >= magnitudes[i - 1] && magnitudes[i] >= magnitudes[i + 1]) {
      count += 1;
    }
  }
  return count;
}

function nextPowerOfTwo(n) {
  let power = 1;
  while (power < n) power *= 2;
  return Math.max(1, power);
}

// In-place iterative radix-2 Cooley-Tukey FFT. `real`/`imag` must be the same power-of-two length.
function fft(real, imag) {
  const n = real.length;
  if (n <= 1) return;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tempReal = real[i]; real[i] = real[j]; real[j] = tempReal;
      const tempImag = imag[i]; imag[i] = imag[j]; imag[j] = tempImag;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      const half = len / 2;
      for (let j = 0; j < half; j += 1) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + half] * curReal - imag[i + j + half] * curImag;
        const vImag = real[i + j + half] * curImag + imag[i + j + half] * curReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + half] = uReal - vReal;
        imag[i + j + half] = uImag - vImag;
        const nextReal = curReal * wReal - curImag * wImag;
        const nextImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
        curImag = nextImag;
      }
    }
  }
}

// Hann-windowed, zero-padded-to-next-power-of-two magnitude spectrum (positive frequencies only).
function magnitudeSpectrum(frame) {
  const n = nextPowerOfTwo(frame.length);
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  const windowDenominator = frame.length > 1 ? frame.length - 1 : 1;
  for (let i = 0; i < frame.length; i += 1) {
    const windowValue = frame.length > 1 ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / windowDenominator)) : 1;
    real[i] = frame[i] * windowValue;
  }
  fft(real, imag);
  const half = n / 2;
  const magnitudes = new Float64Array(half);
  for (let i = 0; i < half; i += 1) {
    magnitudes[i] = Math.hypot(real[i], imag[i]);
  }
  return magnitudes;
}

function rmsDbfsOf(samples) {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) sumSquares += samples[i] * samples[i];
  const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
  if (!Number.isFinite(rms) || rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

// Frame-level voice activity detector. `isSpeech(frame)` expects a Float32Array of `sampleRate`
// (default 16kHz) mono samples, ~30ms (480 samples) at a time, and returns a boolean. A frame is
// speech when RMS clears the noise floor AND the spectrum is peaky (not flat like noise) AND the
// zero-crossing rate falls in a voiced-speech range AND the spectrum carries more than one
// harmonically-distinct peak (rejects a pure tone, which is peaky and RMS-loud but carries exactly
// one).
export function createSpeechDetector({
  sampleRate = 16000,
  flatnessThreshold = 0.4,
  minRmsDbfs = -55,
  // Spec default here was [0.02, 0.35]; lowered the floor to 0.01 because the brief's own
  // vowel-detection test signal (120Hz fundamental + 240/360/480Hz harmonics) measures a
  // zero-crossing rate of ~0.0146 at 16kHz/30ms frames -- a 0.02 floor would reject the exact
  // "IS speech" fixture the spec asks for. Flagged as a deviation, not silently changed.
  zcrRange = [0.01, 0.35],
  minHarmonicPeaks = 2,
  maxHarmonicPeaks = 40,
  peakRelThreshold = 0.2
} = {}) {
  // eslint-disable-next-line no-unused-vars -- kept for API symmetry/future use (frame length is
  // driven by the caller; nothing here currently needs the nominal sample rate directly).
  const _sampleRate = sampleRate;
  let last = { rmsDbfs: -Infinity, flatness: 1, zcr: 0, isSpeech: false };

  function isSpeech(frame) {
    if (!frame || !frame.length) {
      last = { rmsDbfs: -Infinity, flatness: 1, zcr: 0, isSpeech: false };
      return false;
    }
    const rmsDbfs = rmsDbfsOf(frame);
    const magnitudes = magnitudeSpectrum(frame);
    const flatness = spectralFlatness(magnitudes);
    const zcr = zeroCrossingRate(frame);
    const peaks = spectralPeakCount(magnitudes, peakRelThreshold);

    const speech =
      rmsDbfs > minRmsDbfs &&
      flatness < flatnessThreshold &&
      zcr >= zcrRange[0] &&
      zcr <= zcrRange[1] &&
      peaks >= minHarmonicPeaks &&
      peaks <= maxHarmonicPeaks;

    last = { rmsDbfs, flatness, zcr, isSpeech: speech };
    return speech;
  }

  function reset() {
    last = { rmsDbfs: -Infinity, flatness: 1, zcr: 0, isSpeech: false };
  }

  function lastScore() {
    return { ...last };
  }

  return { isSpeech, reset, lastScore };
}
