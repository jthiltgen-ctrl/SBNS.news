# Share-card font

`barlow-condensed-latin-700-normal.ttf` is Barlow Condensed Bold from the
Fontsource Barlow Condensed 5.3.0 distribution. It is licensed under the SIL
Open Font License 1.1; the bundled license is in
`OFL-Barlow-Condensed.txt`.

The content build loads this committed font with system-font discovery
disabled. Keeping the exact font file in the repository makes headline
measurement and PNG rendering offline and deterministic across builds.

`@resvg/resvg-js` 2.6.2 is the only new build dependency. It converts the
repository-owned SVG card template into a 1200×630 PNG without a browser,
remote service, or runtime image request.
