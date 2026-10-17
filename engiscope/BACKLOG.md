# Engiscope backlog

What's next for the eye bench, with the numbers to build it from. Done items
are listed once so the ground truth stays next to the code that used it.

## Next

- **Scene sources.**
  - A real sky from a star catalogue (all on jsDelivr with CORS):
    - d3-celestial `stars.6.json` (657 KB) or `stars.8.json`
    - Yale BSC `bsc5-short.json` (954 KB)
  - Larger Poly Haven night HDRIs: `qwantani_night`, `narrow_moonlit_road`,
    `street_lamp`, `shanghai_bund` (CC0, CORS; file URLs from
    `api.polyhaven.com/files/{id}`).
  - Photometry:
    - E ≈ 10^(−0.4(m + 14.18)) lux
    - Full Moon ≈ 0.26 lux at the eye and 2,500–3,000 cd/m² on its disc
    - Bare LEDs > 10⁶ cd/m²
- **Spectral scene materials.** A sodium lamp should get the 589 nm PSF, not
  the R/G/B split of the white one: decompose the scene into a few spectra and
  convolve each.
- **Preset ghost dots** on the pads for every preset, refreshed on save, as in
  Parhelion and Orbital.

## Living eye

- **Auto blink.**
  - Rate ~15–20/min, and 38–59% of blinks are incomplete.
  - Close ~0.1 s, lid shut 40–200 ms, open ~0.2 s.
  - Peak lid speed 16–19 cm/s, reached as the lid crosses the visual axis.
  - Retinal light drops ~100× while shut.
- **Microsaccades, drift and tremor.**
  - Microsaccades: 1–3/s, mostly < 0.5°.
  - Drift: < 0.5°/s.
  - Tremor: ~90 Hz, a few arcseconds.
  - Lashes at depth d shift across the pupil by d·tanθ, so moving lights
    animate the lash pattern.
- **Pupil hippus** (Frisvad): h(t,p) = p + noise(t/p)·(p_max/p)·√(1 − p/p_max),
  with p_max = 9 mm. Pupil size from luminance: Watson & Yellott 2012.
- **Accommodation microfluctuations.** ~0.5 D peak-to-peak as noise on
  defocus: < 0.6 Hz plus a 1–2.3 Hz band tied to the pulse.
- **Tear film.**
  - Treat the ~3 µm film as a phase screen that evolves after each blink.
  - Aberrations are lowest ~6 s after a blink and rise again at 10–20 s.
  - Breakup in under ~6 s means an unstable film.
  - Gray's observation: squint partway on a point source and reopen, and the
    residual film sharpens the caustic where the lid pushed it.
- **Tear meniscus at the lid margin.** Radius 0.25–0.5 mm, a strong
  cylindrical prism along the lid. It is the likely source of the vertical
  squint streaks. It needs finer pupil sampling than the grid has, so it
  would be a separate refractive term.
- **Crying.** Excess tear fluid pulled by capillary action, moved by blinks:
  thin-film flow on the cornea, rendered as a phase screen.
- **Afterimages.** A temporal adaptation layer on the rendered image.

## More optics from inside the eye

Ritschel et al. 2009, *Temporal Glare*, and related work.

- **Ciliary corona.** Polychromatic speckle from lens particles about 1–2 µm
  across (van den Berg 2005). Random dots in the pupil plane plus the spectral
  sum turn into radial needles.
- **Lenticular halo.** A ring at ~2.5° (blue) to 3.5° (red) from the radial
  lens-fibre grating; absent with pupils under 3 mm.
- **Corneal haloes** from epithelium (~3°) and endothelium (~9°); from oedema
  or debris, 7–14°.
- **Stiles–Crawford effect.** An amplitude weight 10^(−ρr²/2) with
  ρ ≈ 0.05 mm⁻², peak ~0.4 mm nasal and 0.6 mm inferior.
- **Floaters.** Shadows from the vitreous near the retina, which need their
  own Fresnel plane, and they lag eye movements.
- **Starbursts and haloes** from LASIK ablation edges and multifocal or
  contact lens edges, as phase steps in the pupil.
- **Retinal effects** (outside the pupil model): blue-field entoptic,
  Purkinje tree, Haidinger's brush, cone-mosaic sampling.
- **Speed.** Pack two wavelengths per RGBA FFT (≈1.7×) and use radix-4 passes.

## Done (October 2026)

- Lids:
  - curved margins driven by blink and squint
  - upper lid does most of the travel, closing temporal-first
  - lower lid rises a little and slides nasally
  - od/os choice
- Lashes:
  - on both lids, riding the lid margins
  - clumped rows, fanned and curled, with a measured shaft diameter
  - GPU raster; Fresnel propagation from their plane, with near-source
    magnification
- View:
  - shows the perceived image (retinal image turned 180°) and fills the window
  - zoom never goes past the computed field
  - drafts keep the view covered
- Spectral frames laid out on the 400 nm grid with (λmin/λ)² weights.
- Zernike coefficients over a fixed 6 mm pupil; prescription card
  (sph/cyl/axis, 12 mm vertex).
- Absolute exposure on by default.
- GPU scene convolution at the PSF's own scale, with true point sources.
- Straylight in scenes:
  - Uses the CIE 2002 glare spread function, with an age control.
  - Full resolution inside the computed field, a coarse 3×-wide grid beyond it.
  - It buries the float32 rounding of the FFT around very bright lights.
- Antialiased pupil edge, which removed axis-aligned spikes.
- Built-in presets completed from the defaults.
- Thumbnails re-baked.
