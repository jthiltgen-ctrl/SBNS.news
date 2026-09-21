# Share-card fonts

The generated story cards use the canonical SBNS type system:

- `eb-garamond-variable.ttf` — EB Garamond, weight axis 400–800;
- `inter-variable.ttf` — Inter, optical-size axis 14–32 and weight axis
  100–900.

Both files are unmodified TTFs from the Google Fonts repository at pinned
revision `e44c4b011a820c2cbe2fd2cfa8052037d7edb571`. Their SHA-256 digests are:

- EB Garamond: `EF9512F92F6D579E5DC75AF59A5A4B1B8B47D2EDA89E00B954D44520E5369027`
- Inter: `29160A80FF49DDCAB2C97711247E08B1FAB27A484A329CE8B813D820DC559031`

Both families are licensed under the SIL Open Font License 1.1. The exact
license files are included as `OFL-EB-Garamond.txt` and `OFL-Inter.txt`.

The content build loads only these committed files and disables system-font
discovery. That keeps text measurement and PNG rendering offline and
deterministic across machines. `@resvg/resvg-js` 2.6.2 converts the canonical
repository-owned SVG template into 1200×630 PNG output without a browser,
remote service, or runtime image request.
