# Troubleshooting

## Check the installation with the self-test

ParaWerk has a built-in self-test. It starts the geometry kernel, builds a filleted box, compares its
volume with the exact analytic value, exports STEP and checks the 3D graphics, then quits.

| System | Command |
|---|---|
| Windows | `"C:\Users\<you>\AppData\Local\Programs\ParaWerk\ParaWerk.exe" --self-test` |
| macOS | `/Applications/ParaWerk.app/Contents/MacOS/ParaWerk --self-test` |
| Linux (AppImage) | `./ParaWerk-<version>-linux-x86_64.AppImage --self-test` |

The result is printed as JSON; the exit code is `0` when every check passes. The self-test uses a
temporary profile and never changes your settings. The release pipeline runs the same self-test on
every package before it is published.

## The 3D view stays empty or is slow

ParaWerk needs WebGL 2. On machines without a usable GPU driver it falls back to software rendering,
which works but is slow. Update the graphics driver and enable **Settings → Show frame statistics** to
see the frame rate.

## A feature shows a red error

See [When a feature fails](features.md#when-a-feature-fails). The rest of the part stays intact; edit the
feature (for example reduce the fillet radius) or delete it.

## "The geometry kernel was restarted"

The geometry kernel runs in its own worker. If it crashes, ParaWerk restarts it automatically and
rebuilds your part; your document is not affected. Please report the steps that led to the crash in the
[issue tracker](https://github.com/Ujap1994/ParaWerk/issues).

## Known limitations of the alpha

- Not available yet: feature scope (cuts limited to chosen bodies); assemblies (Phase 4).
- A loft follows one guide curve, not several; with a guide it has no centerline.
- Thin features offset lines, arcs and circles, not ellipses and splines; face fillets work between
  planar faces.
- Along a helix, with a twist or with a guide curve, a sweep takes outlines without holes.
- Converted model edges are fixed copies; they do not follow later changes of the model yet.
- Ellipses can only be trimmed as a whole, and *Offset* leaves ellipses and splines out.
- Part files with twisted or guided sweeps, centerline lofts, several bodies or surfaces (format version
  10) cannot be opened by ParaWerk 0.4.0-alpha.1, those with curves or patterns of patterns (format
  version 9) not by 0.4.0-alpha.0.
- Part files with the features of 0.4 (format version 8) cannot be opened by ParaWerk 0.3, and those of
  0.3 (format versions 4–7) not by ParaWerk 0.2; the older version reports a newer file.
- Builds are not code-signed yet.
