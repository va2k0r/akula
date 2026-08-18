# North Sea marine-life models

Downloaded 2026-08-17 as original Sketchfab glTF archives from the public
Sketchfab preservation mirror at
`https://mirror.traines.eu/sketchfab-backup/`. Every selected source archive
contains Sketchfab's own `license.txt`; all five selected works are licensed
under Creative Commons Attribution 4.0.

## Selected runtime sources

| Runtime animal      | Source work and author                                                                                                                           | Source detail                                     | Motion in AKULA                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Orca                | [ORCA](https://sketchfab.com/3d-models/orca-db32f6164828462eaf8d3fe87c0aad85), Cenker Turhan                                                     | 25,292 faces, PBR texture set                     | Procedural path, banking and tail flex; source export has no clip                                     |
| Balenottera azzurra | [Blue whale (Animated, downloadable)](https://sketchfab.com/3d-models/blue-whale-animated-downloadable-1fc22d7e249b41b995dbff1052bb2a1a), Андрей | 12,080 faces, two PBR texture sets, one 24 s clip | Embedded `Play` clip plus local path and banking                                                      |
| Foca                | [Seal](https://sketchfab.com/3d-models/seal-0616281841b44983b1c113b578c0f0ce), rkuhlf                                                            | 610 faces, rigged, three clips, material color    | Embedded `Swim` clip; deliberately retained as the exact animated species fallback                    |
| Medusa              | [Jellyfish](https://sketchfab.com/3d-models/jellyfish-c8ba1a3e4ca54af099e62cd89ba1b661), MrDeivid                                                | 268,524 faces, translucent physical material      | Procedural pulse, tentacle drift and local vertical path; the node-authored source export has no clip |
| Delfino             | [Dolphin model (with easy texture)](https://sketchfab.com/3d-models/dolphin-model-with-easy-texture-ece0cd544108424ba1e665db2149d74d), Sky4gj    | 23,856 triangulated faces, 1K color texture       | Procedural pod path, banking and tail flex; source export has no clip                                 |

The first researched dolphin, [Dolphin Animated](https://sketchfab.com/3d-models/dolphin-animated-1049ca2426d74280831ef3bf9f2dbc57)
by Akshat, is retained under `dolphin/` as a provenance/reference fallback but
is not shipped at runtime. Its embedded swim clip was useful, but the selected
Sky4gj model provides substantially denser geometry and a texture.

## Conversion

- Tool: glTF-Transform 4.4.2.
- Geometry: Draco-compressed with 16-bit positions, 12-bit normals, 14-bit UVs
  and 14-bit generic attributes. No mesh simplification or decimation was
  applied, so source triangle counts are retained.
- Orca and whale textures: resized from 4K to a maximum of 1K and encoded as
  WebP quality 90. The source archives retain the untouched 4K files.
- Dolphin: its supplied 1K JPEG is retained and embedded in the GLB.
- Seal and jellyfish: no external bitmap exists in the source export; their
  supplied materials are retained.
- Whale: a source presentation sphere named `material_5` remains in the GLB
  for provenance but is hidden at runtime because it is not animal geometry.

## Checksums

### Untouched source archives

```text
725d7a0e624fd8f743ddd80c0ee505069c024b587f695049cf8754f243a1d356  orca/archive.zip
708e2aea316b5b2e3f9eaa7ae91ef1d583794e5f9e22dcd7622b3d18befb8f27  baleen-whale/archive.zip
f52c7502b81695fc567c3797a9b0a329faad8e18917bf4dbfa70d844dbf7558e  seal/archive.zip
d58be16efce52f326e322deac4b93dfe97533d1fd3b14b3baa29e80c0d63c702  jellyfish/archive.zip
f7abfbc686c805fbb96798636f2bd77060531224320e1f3ce27cc4a9298e195f  dolphin-textured/archive.zip
1f4084b386428b11eeecd35f4b962f187cd593295199ebb01125ff95beb2e349  dolphin/archive.zip
```

### Runtime GLBs

```text
ace732f92b5ae3e58646aa76d6a5efb36948f1b7cc9090f5445755fe72089ac2  orca.glb
dcf2f1d5139ed8eb0f5884efd061201af2453c448133215acb2947a364622636  baleen-whale.glb
3f24f55e88d865c379178d8879b4cf75612bc3087bbbac82d513a53eb4592ef8  seal.glb
1e4ed3697b50170ccb11f66d82d7c1950fad536be99e2d098364cefe189a1eb6  jellyfish.glb
714ecf3342afc8a6a99d7703d1fc91b624321290b82181d7abef2de04454f987  dolphin.glb
```
