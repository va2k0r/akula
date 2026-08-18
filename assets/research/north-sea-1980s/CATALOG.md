# AKULA — North Sea / Cold War asset collection

Raccolta avviata il 17 agosto 2026 per costruire un Mare del Nord anni Ottanta realistico, operativo e vivo senza trasformarlo in un acquario tropicale.

## Stato della raccolta

- 48 payload binari, circa 294 MB.
- 11 modelli glTF/GLB già scaricati e parse-validati.
- 2 pack 3D CC0: mezzi nautici e fauna animata.
- 4 HDRI pure-sky CC0 e un atlante di caustiche CC0.
- 30 sorgenti audio: bolle, acqua, metallo, esplosioni, siluro, scafo, interni, vento, mare, uccelli e ambiente costiero.
- Nessun acquisto effettuato.
- Nessun asset è ancora nel runtime o nel mix audio del gioco.

Questa cartella è una **source library di ricerca**, non una cartella di shipping. Prima di promuovere un file in `public/assets/` occorrono: controllo visivo o d'ascolto, normalizzazione di scala e assi, ottimizzazione, attribuzione in `ASSET_CREDITS.md` e verifica della build.

Le anteprime Freesound sono state raccolte per valutazione. Per il gioco finale vanno scaricati i master WAV/FLAC dalle pagine originali, mantenendo titolo, autore e licenza indicati qui.

## Confine acustico AKULA

Questi effetti sono materiale separato dall'identità acustica A/B/C già accettata. Non autorizzano modifiche a `AcousticSignatureEngine`, ai preset propulsivi o al bilanciamento approvato. L'integrazione dovrà essere un banco d'ascolto distinto con bypass A/B, non una sostituzione silenziosa.

## Valutazione rapida dei modelli raccolti

| Asset                                                              | Autore / licenza            | Render vertices | Impiego proposto                                               | Stato                                                                       |
| ------------------------------------------------------------------ | --------------------------- | --------------: | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `models/merchant/tanker-james-neal/tanker.glb`                     | James Neal, CC BY 4.0       |         365.094 | Tanker medio/lontano, traffico commerciale                     | **Promuovibile dopo ottimizzazione**                                        |
| `models/merchant/cargo-ship-hungry-drifter/cargo-ship.glb`         | hungry_drifter, CC BY 4.0   |         220.344 | Cargo weathered, traffico di scenario                          | **Promuovibile dopo controllo scala**                                       |
| `models/merchant/bulk-carrier-medialog/bulk-carrier.glb`           | medialog, CC BY 4.0         |       4.883.502 | Bulk carrier vicino o fonte per baking                         | **Source-only: troppo pesante**                                             |
| `models/offshore/supplyship-1to3fall5/supplyship.glb`              | 1to3fall5, CC BY 4.0        |          43.056 | Supply vessel per rotte verso le piattaforme                   | **Miglior candidato runtime immediato**                                     |
| `models/offshore/oil-rig-ansyslearn/oil-rig.glb`                   | AnsysLearn, CC BY 4.0       |         190.140 | Piattaforma fissa generica da rielaborare                      | **Promuovibile come mid-distance**                                          |
| `models/offshore/oil-rig-platform-ansyslearn/oil-rig-platform.glb` | AnsysLearn, CC BY 4.0       |         853.428 | Complesso offshore più denso                                   | **LOD/decimation necessari**                                                |
| `models/offshore/troll-a-ragnar/troll-a.glb`                       | Arkikon, CC BY 4.0          |         391.194 | Silhouette di gravity-based platform                           | **Solo proxy**: Troll A non è anni Ottanta                                  |
| `models/submarines/type-209-artechstudio/type-209.glb`             | Artech, CC BY 4.0           |         266.718 | Diesel-electric contemporaneo al periodo; contatto NATO/export | **Buon candidato**, da rinominare storicamente con precisione               |
| `models/submarines/ohio-yakudami/ohio.glb`                         | Yakudami, CC BY 4.0         |          11.154 | SSBN anni Ottanta, silhouette lunga distanza                   | **LOD utile**; provenienza artistica da riesaminare prima dello shipping    |
| `models/wildlife/herring-amyscottmurray/herring.glb`               | Amy Scott-Murray, CC BY 4.0 |         120.000 | Aringa atlantica per banchi istanziati                         | **Forma/texture ottime**, serve rig o deformazione GPU                      |
| `models/wrecks/boem-shipwreck-15563/shipwreck-15563.glb`           | BOEM Archaeology, CC BY 4.0 |       7.248.060 | Fotogrammetria e materiale per baking/decimation               | **Source-only**; è Golfo del Messico, non relitto storico del Mare del Nord |

I GLB sono stati ottenuti dal mirror pubblico Objaverse 1.0. Autore, pagina originale, disponibilità e licenza CC BY 4.0 sono stati ricontrollati contro l'API Sketchfab il 17 agosto 2026. La pagina originale resta la fonte autorevole; gli identificativi e gli URL sono nel `MANIFEST.tsv`.

## Pack 3D e fauna

### Kenney Watercraft Kit

Pack CC0 con più di quaranta oggetti nautici in OBJ, FBX e glTF. Lo stile è volutamente low-poly: utile per boe, piccoli natanti, props e LOD molto lontani, non come hero art. L'archivio contiene la licenza originale.

Fonte: <https://opengameart.org/content/watercraft-kit>

### Quaternius Animated Fish Pack

Set CC0 con sette creature animate. Va trattato come risorsa di rigging e comportamento, non come atlante biologico del Mare del Nord: usare i pesci generici come base per aringa, sgombro e merluzzo; non popolare automaticamente la scena con manta, squalo e balena.

Fonte: <https://opengameart.org/content/animated-fish>

## Cielo, acqua e visibilità

| Risorsa                                                    | Licenza          | Uso                                                                              |
| ---------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `environment/hdri/kloofendal-overcast-puresky-1k.hdr`      | Poly Haven, CC0  | Coperto freddo e leggibile                                                       |
| `environment/hdri/kloofendal-misty-morning-puresky-1k.hdr` | Poly Haven, CC0  | Foschia bassa e alba grigia                                                      |
| `environment/hdri/wasteland-clouds-puresky-1k.hdr`         | Poly Haven, CC0  | Fronte nuvoloso più drammatico                                                   |
| `environment/hdri/aristea-wreck-puresky-1k.hdr`            | Poly Haven, CC0  | Cielo aperto ma sporco, utile sui relitti                                        |
| `environment/vfx/water-caustics.zip`                       | OpenGameArt, CC0 | Atlante e frame di caustiche; usarle solo in acque relativamente basse e limpide |

Le HDRI pure-sky servono per luce e riflessi; non devono sostituire lo spettro d'onda del gioco. Il Mare del Nord credibile nasce da swell coerente, chop locale, whitecaps, spray, pioggia obliqua, foschia all'orizzonte e variazione di visibilità, non da una singola cubemap.

## Audio raccolto

### Eventi operativi e interni

| File                                                                   |    Durata | Autore / licenza     | Uso proposto                                                            |
| ---------------------------------------------------------------------- | --------: | -------------------- | ----------------------------------------------------------------------- |
| `audio/freesound-previews/35530-torpedo-launch-underwater-cc-by-3.mp3` |  13,740 s | jobro, CC BY 3.0     | Riferimento principale per lancio siluro esterno                        |
| `audio/freesound-previews/124544-underwater-explosion-cc0.mp3`         |   5,616 s | cubix, CC0           | Impulso esplosivo in acqua                                              |
| `audio/freesound-previews/324924-depth-charges-cc0.mp3`                |  12,042 s | Renovatio871, CC0    | Sequenza di esplosioni/distanze                                         |
| `audio/freesound-previews/31574-ship-creak-cc0.mp3`                    | 192,078 s | Walter_Odington, CC0 | Scafo e struttura; da segmentare con parsimonia                         |
| `audio/freesound-previews/438723-vintage-submarine-interior-cc0.mp3`   |  78,720 s | craigsmith, CC0      | Room tone/meccanica interna vintage                                     |
| `audio/freesound-previews/585259-air-bubbles-underwater-cc0.mp3`       | 125,256 s | breiti, CC0          | Sfiato prolungato, aria e gorgoglio                                     |
| `audio/open-game-art/bubbles-loop-1.wav`                               |   4,853 s | BMacZero, CC0        | Loop bolle corto                                                        |
| `audio/open-game-art/bubbles-loop-2.wav`                               |   6,757 s | BMacZero, CC0        | Loop bolle alternativo                                                  |
| `audio/open-game-art/bubbles-single-1.wav`                             |   0,321 s | BMacZero, CC0        | Bolle isolate                                                           |
| `audio/open-game-art/bubbles-single-2.wav`                             |   0,436 s | BMacZero, CC0        | Bolle isolate                                                           |
| `audio/open-game-art/bubbles-single-3.wav`                             |   0,406 s | BMacZero, CC0        | Bolle isolate                                                           |
| `audio/open-game-art/underwater-engine-rumble.ogg`                     |  84,589 s | gmason, CC0          | Materiale grezzo per machinery/rumble, non firma sonar                  |
| `audio/open-game-art/metal-wood-100-cc0.zip`                           |  100 clip | rubberduck, CC0      | Colpi, portelli, metallo e stress strutturale                           |
| `audio/open-game-art/water-splash-slime-40-cc0.zip`                    |   40 clip | rubberduck, CC0      | Acqua, pioggia, bolle e piccoli splash                                  |
| `audio/open-game-art/bang-firework-25-cc0.zip`                         |   25 clip | rubberduck, CC0      | Transienti da elaborare; mai usare dry come esplosione subacquea finale |

Fonti:

- <https://freesound.org/people/jobro/sounds/35530/>
- <https://freesound.org/people/cubix/sounds/124544/>
- <https://freesound.org/people/Renovatio871/sounds/324924/>
- <https://freesound.org/people/Walter_Odington/sounds/31574/>
- <https://freesound.org/people/craigsmith/sounds/438723/>
- <https://freesound.org/people/breiti/sounds/585259/>
- <https://opengameart.org/content/bubble-sound-effects>
- <https://opengameart.org/content/underwater-or-space-engine-rumble>
- <https://opengameart.org/content/100-cc0-metal-and-wood-sfx>
- <https://opengameart.org/content/40-cc0-water-splash-slime-sfx>
- <https://opengameart.org/content/25-cc0-bang-firework-sfx>

### Mare, vento, costa e fauna udibile

| File                                                              |        Durata | Autore / licenza          | Uso proposto                                       |
| ----------------------------------------------------------------- | ------------: | ------------------------- | -------------------------------------------------- |
| `audio/freesound-previews/504641-underwater-ambience-cc0.mp3`     |      46,896 s | Fission9, CC0             | Letto subacqueo neutro                             |
| `audio/freesound-previews/331435-storm-at-sea-cc0.mp3`            |     196,702 s | Codeine, CC0              | Tempesta di superficie                             |
| `audio/freesound-previews/436954-roaring-sea-cc-by-4.mp3`         |     309,029 s | allthingssound, CC BY 4.0 | Mare forte continuo                                |
| `audio/freesound-previews/436955-gulls-cc-by-4.mp3`               |     386,900 s | allthingssound, CC BY 4.0 | Gabbiani vicini; usare solo presso costa/navi/rig  |
| `audio/freesound-previews/436956-distant-gulls-cc-by-4.mp3`       |     755,644 s | allthingssound, CC BY 4.0 | Gabbiani molto lontani                             |
| `audio/freesound-previews/635912-skylarks-windy-dunes-cc0.mp3`    |     202,800 s | Kinoton, CC0              | Dune/costa, non open sea                           |
| `audio/freesound-previews/635917-slow-waves-stony-beach-cc0.mp3`  |     245,976 s | Kinoton, CC0              | Battigia rocciosa                                  |
| `audio/freesound-previews/635918-water-through-rocks-cc0.mp3`     |     118,536 s | Kinoton, CC0              | Frangenti ravvicinati                              |
| `audio/freesound-previews/656679-town-at-north-sea-cc0.mp3`       |      87,168 s | Kinoton, CC0              | Porto/cittadina del Mare del Nord                  |
| `audio/freesound-previews/656680-heavy-wind-grass-bushes-cc0.mp3` |     200,040 s | Kinoton, CC0              | Vento costiero; evitare offshore senza vegetazione |
| `audio/freesound-previews/760212-thunder-clap-rumble-cc0.mp3`     |      13,512 s | Kinoton, CC0              | Tuono e coda distante                              |
| `audio/open-game-art/ocean-wave-01.flac` … `04.flac`              | 2,250–4,000 s | jasinski via qubodup, CC0 | One-shot di onda/splash in FLAC 24-bit             |

Fonti Freesound: <https://freesound.org/s/504641/>, <https://freesound.org/s/331435/>, <https://freesound.org/s/436954/>, <https://freesound.org/s/436955/>, <https://freesound.org/s/436956/>, <https://freesound.org/s/635912/>, <https://freesound.org/s/635917/>, <https://freesound.org/s/635918/>, <https://freesound.org/s/656679/>, <https://freesound.org/s/656680/>, <https://freesound.org/s/760212/>.

Onde FLAC: <https://opengameart.org/content/beach-ocean-waves>

## Ricette sonore da prototipare

### Lancio siluro

Due prospettive, mai lo stesso sample a volume diverso:

1. **Dentro il battello:** sequenza portello/attuatore, colpo pneumatico corto, trasferimento meccanico nello scafo, coda di acqua filtrata.
2. **Idrofono esterno:** impulso compresso, cavitazione iniziale, bolla espulsa e transizione verso propulsore/ping del siluro.

Il file jobro è un riferimento forte, ma il risultato finale dovrebbe essere una composizione proprietaria di 4–6 layer.

### Sfiato e ballast blow

Combinare loop lunghi e bolle isolate con densità dipendente da flusso e profondità. Aggiungere un tremore strutturale interno separato. Evitare il semplice “rumore di scuba” uniforme.

### Esplosione subacquea

Creare almeno tre componenti: impulso waterborne, coda a bassa frequenza e risposta dello scafo. Distanza e termoclino devono cambiare arrivo, banda e riverbero; il lampo visivo può essere quasi assente a distanza.

### Hull creaking

Lo scricchiolio deve essere sporadico e state-driven: profondità, variazione di quota, manovra, mare e danno. Se suona continuamente diventa una haunted house e perde valore fisico.

## Come rendere vivo il Mare del Nord

Il “vivo” qui deve venire da sistemi che si incrociano, non da quantità casuale di animali.

### Superficie

- Traffico raro ma leggibile: tanker e bulk carrier sulle rotte, trawler nelle aree di pesca, supply vessel tra costa e piattaforme, unità militari su pattuglia.
- Scie che persistono e si deformano nello spettro d'onda; prua, spray e rollio devono dipendere da rotta e sea state.
- Rig con luci industriali, flare intermittente, gru lente, supply traffic, elicottero occasionale, nebbia che ne rivela prima le luci e poi la massa.
- Fronti meteo in movimento: pioggia locale, squall, foschia salina, schiarite fredde, alba/tramonto bassi.
- Gabbiani solo vicino a costa, pescherecci, relitti affioranti e piattaforme; il largo non deve essere una voliera.

### Sott'acqua

- Marine snow e particolato con densità variabile; sedimento sospeso presso fondale e relitti.
- Banchi di aringhe/sugarelli/sgombri come volumi che si comprimono, girano e reagiscono, non pesci individuali equidistanti.
- Merluzzo e pesci demersali vicino al fondo; meduse sparse; focene e foche come eventi rari, non decorazione costante.
- Kelp solo in fascia costiera e relativamente bassa; offshore profondo più spoglio, fangoso e scuro.
- Relitti colonizzati, reti fantasma, cavi e pipeline come geografia tattica e narrativa.
- Visibilità e colore legati a profondità, bloom fitoplanctonico, stagione, sospensione e meteo in superficie.

### Scala e densità

Usare tre anelli:

- **Hero/near:** pochi asset ottimizzati, collisione e wake completi.
- **Mid:** silhouette e materiali semplificati, animazioni ridotte.
- **Far/horizon:** impostori o mesh minime, luci e scia come segnali principali.

## Roster storico da cercare

### Sovietico

- Sottomarini: Project 971 Akula (già presente), Victor III / 671RTM, Alfa / 705, Kilo / 877, Oscar / 949.
- Superficie: Krivak / 1135, Udaloy / 1155, Sovremenny / 956, Slava / 1164.

### NATO / Royal Navy

- Sottomarini: Trafalgar, Swiftsure, Oberon; Type 209 come contatto export/NATO.
- Superficie: Leander, Type 22, Type 42, Oliver Hazard Perry, Bremen F122.

### Civile e offshore

- Stern e beam trawler, ferry, tug, coaster, tanker, bulk/general cargo, offshore supply vessel.
- Brent, Statfjord, Ekofisk, Piper Alpha, Forties e Frigg come riferimenti d'epoca. Ogni modello contemporaneo va trattato come kit strutturale, non come replica storica.

## Shortlist premium — nessun acquisto effettuato

I prezzi sono quelli osservati il 17 agosto 2026 e possono cambiare. Serve approvazione prima di qualsiasi acquisto.

| Priorità | Asset                                                                                                                                                     |       Prezzo osservato | Nota                                                 |
| -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------: | ---------------------------------------------------- |
|        1 | [Udaloy class destroyer](https://www.cgtrader.com/3d-models/watercraft/military-watercraft/udaloy-class-destroyer-09cb0446-71cf-403a-b70d-e70dfbc96ebf)   |     $8 sale / $16 list | Ottimo bersaglio sovietico anni Ottanta              |
|        1 | [Sovremenny 956](https://www.cgtrader.com/3d-models/watercraft/military-watercraft/sovremenny-956-0d27f4da-f774-437d-a9d2-063afcf92f88)                   |           non annotato | Contatto sovietico essenziale                        |
|        1 | [HMS Type 22 F90 Brilliant](https://www.cgtrader.com/3d-models/military/military-vehicle/hms-type-22-frigate-f90-brilliant)                               |    $18 sale / $60 list | Royal Navy, perfetto per il teatro                   |
|        1 | [Trafalgar class](https://www.cgtrader.com/3d-models/watercraft/military-watercraft/submarine-trafalgar-class)                                            |                    $49 | SSN Royal Navy contemporaneo                         |
|        2 | [Leander class PBR](https://www.cgtrader.com/3d-models/watercraft/military-watercraft/leander-class-frigate)                                              |   $50 sale / $100 list | Alta qualità, ancora attiva nel periodo              |
|        2 | [Leander class rigged glTF](https://www.cgtrader.com/3d-models/watercraft/military-watercraft/leander-class-frigate-8ee9a7c3-b6f1-46fc-a436-b70f69af8b28) | $41.40 sale / $69 list | glTF e parti animate, ma senza texture               |
|        2 | [Krivak class](https://www.cgtrader.com/3d-models/watercraft/military-watercraft/krivak-class-frigate-c8c5552c-56ed-4d35-826d-903d9e398455)               |           non annotato | Piattaforma sovietica frequente                      |
|        2 | [Kilo class](https://www.cgtrader.com/3d-models/watercraft/military-watercraft/kilo-class-submarine-da842ce0-97bb-48b3-90c7-3033c90545f0)                 |           non annotato | Diesel-electric sovietico dal 1982                   |
|        2 | [North Sea diesel trawler](https://www.cgtrader.com/3d-models/watercraft/industrial-watercraft/north-sea-diesel-trawler)                                  |           non annotato | Civile, textured e con parti separate                |
|        3 | [Beam trawler](https://www.cgtrader.com/3d-models/watercraft/industrial-watercraft/beam-trawler-fishing-ship-low-poly-3d-model)                           |                    $68 | Utile per pesca e clutter di coperta                 |
|        3 | [Sleipner Vest platforms](https://www.turbosquid.com/3d-models/3d-sleipner-vest-platforms-model/1193251)                                                  |                    $45 | Riferimento geografico, **non** replica anni Ottanta |
|        3 | [Fab game-ready oil rig](https://www.fab.com/listings/641f46b3-b762-4f21-b059-2eef8b8df0a6)                                                               |           non annotato | Kit da rielaborare e verificare per export web       |

## Scarti e cautele già registrati

- **Sovremenny Sketchfab “ripped from Cold Waters”**: escluso, anche se la pagina mostrava CC BY. La provenienza dichiarata è incompatibile con una pipeline pulita.
- **Kilo_RevA01**: ispezione visiva; non è un sottomarino utilizzabile. Escluso.
- **German Navy F122 CC BY**: storicamente pertinente ma il modello disponibile è una sagoma bianca molto grezza. Non scaricato; insufficiente per il target realistico.
- **RARP Oil Rig**: stile diorama/marker, escluso.
- **Deepwater Horizon**: modello interessante ma moderno e del Golfo del Messico; solo riferimento strutturale, non asset storico del Mare del Nord.
- **North Sea coastal shipping ambience di klankbeeld**: pagina CC BY 4.0, ma l'autore chiede di non redistribuire il field recording come stock grezzo. Catalogato mentalmente come riferimento, non scaricato.
- **Troll A**: raccolto come base strutturale e silhouette, mai etichettare la scena come Troll A negli anni Ottanta.
- **Shipwreck 15563**: raccolto per qualità fotogrammetrica, mai presentarlo come relitto del Mare del Nord.

## Ordine di promozione consigliato

1. Supplyship + tanker + cargo ship: scala uniforme, LOD e wake anchors.
2. Oil Rig AnsysLearn: re-authoring in chiave Brent/Statfjord generica, luci e flare separati.
3. Herring: rig GPU e banco da 100–2.000 istanze con avoidance.
4. Type 209: verifica proporzioni, assi e normal map; poi contatto sonar/visuale.
5. Banco audio separato: torpedo launch, ballast/bubbles, explosion transmission, hull stress.
6. Solo dopo: decimation/baking del bulk carrier e del relitto fotogrammetrico.

Dettagli macchina-legibili: `MANIFEST.tsv`. Integrità dei payload: `CHECKSUMS.sha256`.

## Verifiche eseguite

- 48/48 payload presenti nel manifest e nel file checksum.
- 48/48 SHA-256 verificati.
- 11/11 GLB letti correttamente con glTF Transform 4.2.1.
- 27/27 file audio aperti da Core Audio con durata e formato validi.
- 6/6 archivi ZIP superano il test d'integrità.
- 4/4 HDR riconosciuti come Radiance HDR.
