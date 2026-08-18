# MAREANO 5 m bathymetry — eastern shelf patch

- **Use:** authoritative macro bathymetry for the 8 × 8 km Frostbite chart
- **Provider / attribution:** Kartverket / MAREANO
- **Dataset:** _Depth data - terrain models 5 metres grid_
- **Dataset record:**
  https://data.norge.no/en/datasets/21edd19c-1f1c-3204-a733-160caab90481/dybdedata-terrengmodeller-5-meters-grid
- **Service:** Kartverket WCS DTM2, coverage `bathymetry05m`
- **WCS capabilities:**
  https://wms.geonorge.no/skwms1/wms.dtm2?service=WCS&request=GetCapabilities&version=2.0.1
- **Downloaded:** 2026-08-17
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
- **License URL:** https://creativecommons.org/licenses/by/4.0/
- **CRS:** ETRS89 / UTM zone 33N (`EPSG:25833`)
- **Centre:** 71.873203 N, 17.152673 E
- **Subset bbox:** `570737.629, 7972123.956, 578737.629, 7980123.956`
- **Nominal source spacing:** 5.033278 m
- **Source dimensions:** 1589 × 1589 Float32 GeoTIFF
- **Source elevation range:** -375.010010 to -311.119995 m
- **Source file:** `bathymetry05m.tif`
- **Source SHA-256:**
  `e01a769c077a5629ae49b0a3d347a7236bf72d821ba830cf606f66e586e78f95`

Exact GetCoverage request:

```text
https://wms.geonorge.no/skwms1/wms.dtm2?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=bathymetry05m&FORMAT=image%2Ftiff&SUBSET=x(570737.629,578737.629)&SUBSET=y(7972123.956,7980123.956)
```

## Runtime transformation

`scripts/build-mareano-bathymetry.py` box-filters the source to a 321 × 321
grid (25 m spacing) and stores source elevations to 0.1 m precision in the
synchronous TypeScript payload `src/game/MareanoBathymetry.ts`.

AKULA maps the source elevation range linearly into -310 to -145 m for a
2.5826× vertical exaggeration. Horizontal coordinates, feature placement and
relative elevations remain survey-derived; displayed game depth is therefore
not a navigationally valid reproduction of the source DTM.

Suggested attribution: “Bathymetry: Kartverket / MAREANO, licensed under
CC BY 4.0; vertically exaggerated and downsampled for AKULA.”
