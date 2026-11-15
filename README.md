# SPONDON · স্পন্দন

A real-time acoustic DSP laboratory that runs in the browser. Speak (or let the built-in synthetic voice speak) and SPONDON measures the pitch and the resonances of the vocal tract every frame, places the vowel on the F1/F2 chart, and draws it as a Chladni standing-wave figure.

*Spondon* is Bangla for pulse, or vibration. The vowel targets include six Bangla vowels (অ আ ই উ এ ও) alongside English /æ/ and /ɜː/.

> Educational and scientific visualisation. SPONDON is not a medical or diagnostic device.

## What is in it

| Page | What it is for |
| --- | --- |
| `/` | A keyboard of vowels: press a key (or A S D F G H J K) to hear a vowel and watch its figure form on the orange plate, or sing into it. Then a bench of nine live instruments and the signal chain turned by the scroll |
| `/lab` | The instrument. Vowel chart, 3D sand plate, spectrum with LPC envelope, Z-plane, scope, spectrogram, pitch track and every reading. Built-in voice, test signals, microphone or another tab's audio; freeze, trace a frame stage by stage, and five "break the signal" experiments |
| `/vowels` | The eight reference vowels: where each sits, how the mouth makes it, how it sounds, its figure |
| `/compare` | Record takes or open audio files, keep them in this browser with notes, and lay one over another |
| `/classroom` | Seven units for a first signals course (sampling, Fourier series, windows and leakage, the spectrogram, autocorrelation pitch, linear prediction, the z-plane), each with a live signal, a question and a folded answer |
| `/guide` | How to use the lab, step by step, with troubleshooting |
| `/method` | Every stage of the analysis with its equation and a live trace |
| `/developers` | The HTTP API, with a live synthesise-then-analyse round trip |
| `/archive`, `/privacy` | Where the idea comes from, with picture credits; what is and is not kept |

Light and dark themes follow the system setting until you choose one with the toggle in the bar.

### Test signals

Besides the synthetic voice, the built-in source can be a sine, square, sawtooth or triangle wave, two tones 20 dB apart, a 100 Hz–3 kHz sweep, white noise or an impulse train (`src/lib/dsp/signals.ts`). The periodic ones are built from harmonics up to 8 kHz, so they are band-limited, and their spectra are known in advance. Open one directly with `/lab?signal=square&hz=200`; `/lab?vowel=ii` opens on a vowel and `/lab?exp=3` on an experiment.

## Measured, derived, mapped

Every figure on screen belongs to one of three kinds, and the interface says which.

| Kind | What | How |
| --- | --- | --- |
| Measured | F0, level, zero-crossing rate, jitter, shimmer, syllable rate | Directly from the waveform |
| Derived | LPC coefficients, spectral envelope, Z-plane poles, F1–F3 with bandwidths, distance to the target vowel | From the all-pole model fitted to each frame |
| Visual mapping | The Chladni figure | F1 and F2 choose the plate's mode numbers. It is a picture of the vowel, not a measurement |

## The signal chain

Each animation frame (about 0.7 ms of work at 48 kHz on a laptop) runs:

1. **Decimate** to about 12 kHz with a Hamming-windowed sinc low-pass (Nyquist at 6 kHz keeps F1–F3).
2. **Pitch** by the McLeod Pitch Method on 1024 samples, with parabolic interpolation, between 75 and 450 Hz.
3. **Pre-emphasis** $y[n] = x[n] - 0.97\,x[n-1]$ to flatten the glottal tilt.
4. **Window** 512 samples (rectangular, Hamming, Hann or Blackman, switchable live).
5. **FFT**: in-place radix-2 Cooley–Tukey, 1024 points, scaled so 0 dB is a full-scale sinusoid.
6. **Linear prediction**: autocorrelation, then Levinson–Durbin for order $p = 12$.
7. **Poles**: roots of $A(z)$ by Durand–Kerner iteration, each turned into a frequency and a bandwidth.
8. **Formants**: the first three poles in physiological ranges, a five-frame median, light smoothing.
9. **Stability**: one peak per glottal cycle on the full-rate signal gives jitter and shimmer, with a 30-frame rolling median.
10. **Target**: distance to the chosen vowel on the Bark scale, a 0–100 score and a coaching hint.

The equations behind it:

$$w_{\text{Hamming}}[n] = 0.54 - 0.46\cos\!\left(\frac{2\pi n}{N-1}\right)$$

$$H(z) = \frac{G}{A(z)} = \frac{G}{1 - \sum_{k=1}^{p} a_k z^{-k}}$$

$$F_i = \frac{\theta_i f_s}{2\pi}, \qquad B_i = -\frac{\ln r_i \, f_s}{\pi} \qquad \text{for a pole } z_i = r_i e^{j\theta_i}$$

$$\text{jitter} = \frac{\operatorname{mean}|T_i - T_{i+1}|}{\operatorname{mean} T_i} \times 100\%, \qquad \text{shimmer} = \operatorname{mean}\left|20\log_{10}\frac{A_{i+1}}{A_i}\right|\ \text{dB}$$

$$z(f) = \frac{26.81 f}{1960 + f} - 0.53 \ \text{Bark} \quad \text{(Traunmüller 1990)}$$

The figure is the standing wave $C(x, y) = \cos(n\pi x)\cos(m\pi y) - \cos(m\pi x)\cos(n\pi y)$; sand collects where $C = 0$.

## How it is checked

`src/lib/dsp/synth.ts` is a source-filter voice (a jittered impulse train through three two-pole resonators). Its poles are known exactly, so it is both the no-microphone voice of the lab and the ground truth for the tests (`npx vitest run`):

- F1 and F2 recovered within 60 Hz for /ɑː/ and /iː/ at 12, 44.1 and 48 kHz.
- All eight reference vowels resolve to themselves.
- Pitch within 1.5 Hz from 95 to 310 Hz, with no octave error when the fundamental is weak.
- A Levinson–Durbin solution, a polynomial's roots and a pole-to-formant conversion against values worked by hand.
- The API end to end: a WAV from `/api/synth` sent to `/api/analyze` comes back as the vowel it was.
- Each test signal has the spectrum theory says it should: a square wave's odd harmonics at 1/k, a triangle's at 1/k², a flat comb for the impulse train, nothing above 8 kHz.
- The local takes vault saves, lists, updates and deletes takes, and round-trips its export format.

80 tests in all, across the DSP engine, the API, the lab's runtime and the takes vault.

**Known limitation.** Jitter and shimmer come from peak picking on the waveform, which reads about 1.2–1.4× high because one cycle's ringing shifts the next peak. The tests hold the reading to between 0.9× and 1.6× the injected value and to rising with it. Use them as relative measures, not clinical ones.

## HTTP API

The lab never sends audio anywhere: everything above runs in the tab. The API is for scripts and notebooks. It stores nothing and allows any origin.

```bash
# The eight vowel targets, with Bark coordinates and figure modes
curl https://<host>/api/vowels

# A synthetic vowel as 16-bit mono WAV
# vowel: aa ii uu e oo o ae er · f0 60–400 Hz · jitter 0–5 % · shimmer 0–3 dB
# duration 0.1–5 s · rate 8000 16000 22050 24000 32000 44100 48000
curl -o ii.wav "https://<host>/api/synth?vowel=ii&f0=180&duration=1.5&rate=16000"

# Measure a recording: WAV (PCM 8/16/24/32-bit or float), up to 30 s and 4 MB
curl -X POST -H "Content-Type: audio/wav" --data-binary @ii.wav \
  "https://<host>/api/analyze?target=ii"
```

`/api/analyze` returns one frame every 10 ms (`t`, `f0`, `f1`, `f2`, `f3`, `voiced`) and a summary: voiced fraction, median F0 and F1–F3, jitter, shimmer, the nearest vowel, and the distance to `target` if one was given. Errors come back as `{ "error": "…" }` with status 400, 413 or 415.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000

npm run build
npx tsc --noEmit
npx vitest run
npx eslint src
```

On Windows, run these from PowerShell. Under Git Bash's lowercase `/d/…` path, Vitest fails to load.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Web Audio API, three.js with React Three Fiber, Vitest.

## Layout

```text
src/types/dsp.ts            telemetry contract between the engine and the views
src/lib/dsp/                windows, FFT + LPC + roots, pitch + jitter, vowel targets,
                            synthetic voice, frame analyser, audio controller,
                            WAV codec, offline analysis,
                            classroom test signals, audio file ingest
src/lib/storage/            the local takes vault (IndexedDB, never uploaded)
src/app/api/                /api/vowels, /api/synth, /api/analyze
src/store/lab-store.ts      the shared runtime: one analyser, many views, no per-frame React state
src/components/instrument/  the canvases (draw.ts), the 3D plate, readouts and controls
src/app/, src/components/   pages, the lab, the homepage, the docs
```

## Credits

The archival pictures are from Wikimedia Commons:

- Ernst Chladni, *Entdeckungen über die Theorie des Klanges*, Leipzig 1787, title page. Public domain.
- Rudolph Koenig, apparatus after Helmholtz with ten resonators, 1889 price list. Public domain.
- “Chladni plate 04”, “Chladni plate 10” and the video “Prato de Chladni 14”: exhibit by Estes Objethos Atelier, photo and video by Rodrigo Tetsuo Argenton. CC BY-SA 4.0.
- “A selection of Helmholtz resonators from 1870, Hunterian Museum, Glasgow” by Stephencdickson. CC BY-SA 4.0.

The reference vowel formants are typical adult values from the phonetics literature, rounded. They are a practice target, not a norm for any speaker.
