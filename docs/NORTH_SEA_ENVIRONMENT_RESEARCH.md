# North Sea / Barents environment research

Research pass: 2026-08-17

## What makes the seabed specific

MAREANO's Barents Sea surveys are a better art-direction reference than a
generic Arctic asset pack. The recurring signatures are:

- dense fields of pockmarks, commonly about 20-30 m across and 2-4 m deep;
- iceberg plough marks and glacial furrows;
- boulders, soft clay, burrows and modern trawl marks;
- habitat patches rather than uniform decoration: anemone-covered stones,
  sponge gardens, sea pens and cold-water corals;
- suspended life that can look like a snowstorm on video: comb jellies and
  arrow worms in colder water, krill and mysids farther south;
- cod, haddock, redfish, flatfish, prawns and starfish around productive
  bottom habitat.

Primary references:

- https://mareano.no/en/news/news_2013/a_seabed_full_of_pockmarks
- https://www.mareano.no/en/news/news_2013/barents_sea_south_east_mother_natures_pantry
- https://www.mareano.no/en/news/news-2019/new-general-biotope-map-for-the-barents-sea
- https://www.mareano.no/en/topics/habitats/vulnerable-biotope-maps

## Lateral rendering decision

The original scene treated life as static set dressing. The first corrective
slice instead combines:

1. map-scale glacial scours and small physical pockmark fields;
2. rare benthic hotspots using a real cold-water coral scan;
3. moving fish schools that occupy specific routes and evade the camera;
4. existing marine snow as the continuous low-amplitude layer, with rare blue
   flashes confined to close habitat encounters;
5. an underwater chase distance and exposure that keep this content inside
   the camera's actual visibility envelope.

This avoids turning the Barents Sea into a tropical aquarium. Long empty
intervals remain, but an encounter has movement, parallax and ecological
structure.

The localized flashes are an intentionally restrained ecological abstraction:
MAREANO describes comb jellies and arrow worms as a suspended "snowstorm" in
Barents survey footage, while NOAA reports that bioluminescence is widespread
in deep pelagic animals and that blue is the most common transmitted color.
AKULA does not make the coral itself glow; a sparse particle layer around the
habitat reacts only at close range.

- https://oceanexplorer.noaa.gov/ocean-fact/bioluminescence/

## Shipped scientific asset

The Smithsonian provides a downloadable 20k Draco GLB of _Lophelia pertusa_
(_Desmophyllum pertusum_), the reef-building cold-water coral used as a species
reference by MAREANO. The media is CC0 under Smithsonian Open Access.

- Object: https://3d.si.edu/object/3d/lophelia-pertusa%3A212a8c08-42e9-4895-803b-2bfc54e82c22
- API docs: https://3d-api.si.edu/api-docs/
- Rights: https://www.si.edu/openaccess/faq

Exact provenance and hash are recorded in
`assets/source/smithsonian-lophelia/SOURCE.md` and `ASSET_CREDITS.md`.

## Real bathymetry acquisition and result

Kartverket's current DTM2 WCS exposes the MAREANO 5 m coverage as Float32
GeoTIFF under CC BY 4.0. The legacy MAREANO browser did not load reliably, so
the selection used the authoritative WMS/WCS services directly rather than
treating the old viewer as the data source.

Two valid 8 × 8 km candidates were measured. Eggakanten offered a 331 m shelf
break and long sand waves; the selected eastern-shelf patch offered less raw
relief but much more route-scale variety: a meandering depression, pockmarks,
furrows, ridges and modern seabed-use traces. A documented Hola candidate was
also probed, but the current 5 m WCS subset was zero-filled and was therefore
not used.

The selected GeoTIFF now drives the renderer, vehicle collision, seabed lidar,
sonar occlusion and tactical chart through one synchronous 321 × 321 runtime
grid. Only 20-30 m close-range pockmark bowls remain an enhanced layer because
they fall between 25 m runtime samples. Photogrammetry cliffs were reduced to
sparse outcrops located on survey-derived slopes.

- Dataset and CC BY 4.0 record:
  https://data.norge.no/en/datasets/21edd19c-1f1c-3204-a733-160caab90481/dybdedata-terrengmodeller-5-meters-grid
- WCS service record:
  https://data.norge.no/nb/data-services/4aaa0747-728a-38c9-819d-1ac6d680c73e/dybdedata-terrengmodeller-dtm-wcs
- MAREANO bathymetric mapping:
  https://mareano.no/tema/dybdekartlegging

Exact bboxes, measurements, previews and the rejected-candidate note are in
`assets/research/mareano-bathymetry/COMPARISON.md`. Source hash, GetCoverage
request and vertical transformation are in
`assets/source/mareano-shelf-east/SOURCE.md`.

## Reviewed but not acquired

- Sketchfab has several downloadable CC BY Lophelia scans and a 39k-triangle
  School of Herring model. Download access is account-gated, so none were
  imported in this pass.
- Fab's Standard License permits use outside Unreal Engine, but current
  Megascans availability and acquisition price are asset-specific. No Fab
  content was assumed free or added without an explicit project acquisition.
