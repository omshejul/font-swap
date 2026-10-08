# SwapFont demo video

24 seconds, 1920×1080, 30 fps. Made with Claude and the Motion Graphics Guide, using actual SwapFont v0.4.2 screenshots.

The video shows picking text, searching for a replacement, an instant swap and multiple font pairs. Undo and edit stay in the extension but have no dedicated video scene.

## Edit and render

Requires Node.js 22+, FFmpeg and Chrome. All fonts, screenshots, audio and GSAP are local.

```sh
npm ci
npm run lint
npm run check
npm run render -- --output renders/swapfont-demo.mp4 --fps 30 --format mp4
```

`index.html` contains the seekable GSAP composition. Preview with `npm run dev`, then stop the preview server after five minutes.

## Soundtrack and assets

`scripts/make_audio.py` creates the original 120 BPM electronic soundtrack and click/swap sounds without external samples. It needs Python and NumPy only; rendering uses the bundled WAV files. Run `python3 scripts/make_audio.py` to regenerate them. Track timing and levels are in `index.html`.

Screenshots and the rounded SwapFont icon come from this repository. Inter font licensing is in `fonts/`; GSAP keeps its upstream license header in `vendor/`. The unused starter tick/chime files came from the user-requested Motion Graphics Guide kit.

## Verified output

The final MP4 has 720 H.264 frames, yuv420p, exact 24-second duration and AAC stereo at 48 kHz. FFmpeg measured -16.1 LUFS integrated loudness and -1.9 dBFS true peak. Audio was verified by measurement, not listening. HyperFrames found zero errors and zero layout issues across 178 samples; nine structural/reused-image warnings remain in this compact composition. Scene and end-card frames were visually reviewed.

The published MP4 and poster are hosted at https://omshejul.com/app/swapfont in the portfolio-next repository.
