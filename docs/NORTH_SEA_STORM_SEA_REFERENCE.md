# North Sea storm-sea reference

AKULA's surface baseline targets an open northern North Sea gale, not a rogue
wave or tsunami. The intended read is a heavy, irregular mass of slate-grey
water: steep local wind waves, a lower crossing Atlantic swell, broken white
crests and wind-aligned foam streaks. Vessel motion continues to sample the same
surface used by the renderer.

## Evidence boundary

- The UK Met Office classifies 6-9 m wave height as a **high** sea. Its Beaufort
  table associates a gale with about 5.5 m probable wave height (7.5 m probable
  maximum) and a strong gale with about 7 m (10 m probable maximum).
- A UK government North Sea assessment reports that significant wave height
  exceeds 4 m during 20-30% of the October-March period north of 57 degrees N.
- MET Norway's operational models explicitly separate locally generated
  `wind-sea` from remotely generated `swell`; real sea state is their combined
  spectrum, potentially with multiple swell systems.
- The Copernicus NW Shelf reanalysis provides separate wind-wave, primary swell
  and secondary swell height, period and direction fields. That supports a
  crossed, bimodal sea rather than one enlarged sine wave.

## AKULA target state

| Component      |          Hs |      Tp | Directional role                      |
| -------------- | ----------: | ------: | ------------------------------------- |
| Local wind sea |       6.3 m |   8.2 s | Dominant, broad 42-degree fan         |
| Atlantic swell |       3.2 m |  12.8 s | Lower, 44 degrees across the wind sea |
| Combined       | about 7.1 m | bimodal | Met Office **high** sea               |

This is deliberately below the Met Office `very high` 9-14 m band. It should
feel dangerous and physical around a 110 m submarine while keeping traffic
animation readable and avoiding cinematic walls of water.

## Runtime rendering and sound contract

- The geometric sea uses 72 equal-energy, low-discrepancy samples from the two
  continuous JONSWAP spectra. Frequency and direction are not paired on a
  repeated lattice, which avoids a handful of dominant rolling bands.
- The normal field is a footprint-filtered 0.52-5.1 m short-wave band. Long
  normal waves were removed because they stretched reflected cloud detail into
  viscous, concentric “oil” contours at grazing angles.
- The storm reflection is roughened before it reaches the Fresnel blend;
  refraction displacement is restrained. Whitecaps remain tied to crest/fold
  energy rather than being a full-surface white texture.
- Driving rain is actual scene geometry around the camera. Sparse randomized
  impacts perturb the local water normal; their restrained value cue is visible
  from above, while the rings and brief contact crowns receive more contrast
  when the moving surface is seen from below.
- Surface aerial perspective has a minimum density for distance separation and
  a hard maximum for playability. A low, broken salt-mist band adds depth at the
  horizon without becoming an opaque draw-distance wall.
- A dedicated surface bus loops the CC0 “Storm at Sea” recording. Camera medium
  opens it to 15.5 kHz / gain 0.43 in air and closes it to 145 Hz / gain 0.0025
  underwater. Sonar contacts, comms and own-ship sound never enter this bus.

The currently promoted storm recording is the 196.702 s Freesound MP3 preview;
its original master should replace the preview before a final distributable
audio package if it is available.

## Sources

- Met Office, Beaufort wind force scale:
  https://weather.metoffice.gov.uk/guides/coast-and-sea/beaufort-scale
- UK Department of Trade and Industry, *2nd Strategic Environmental Assessment
  - Offshore North Sea*, section 5.4.2:
    https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/197798/SEA2_Assessment_Document.pdf
- MET Norway, Oceanforecast data model:
  https://docs.api.met.no/doc/oceanforecast/datamodel.html
- Copernicus Marine, Atlantic-European North West Shelf wave reanalysis:
  https://data.marine.copernicus.eu/product/NWSHELF_REANALYSIS_WAV_004_015/description
