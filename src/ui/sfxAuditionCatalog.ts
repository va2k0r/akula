export type SfxAuditionDecision = "keep" | "reject" | "undecided";

export interface SfxAuditionItem {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly sourceTitle: string;
  readonly category: string;
  readonly assetPath: string;
  readonly durationSeconds: number;
}

const RESEARCH_ROOT =
  "/assets/research/submarine-sfx-2026-08-17/masters/usc-sound-effect-archive";

export const SFX_AUDITION_ITEMS = [
  item(
    "usc-g45-10",
    1,
    "Battaglia a bordo del sommergibile",
    "G45-10 · Submarine Battle",
    "DANNO / ESPLOSIONI",
    "explosions/g45-10-submarine-battle.wav",
    87.514958,
  ),
  item(
    "usc-g45-11",
    2,
    "Carica di profondità",
    "G45-11 · Submarine Depth Charge",
    "DANNO / ESPLOSIONI",
    "explosions/g45-11-submarine-depth-charge.wav",
    60.855417,
  ),
  item(
    "usc-g45-12",
    3,
    "Esplosioni da missile",
    "G45-12 · Submarine Missile Explosions",
    "DANNO / ESPLOSIONI",
    "explosions/g45-12-submarine-missile-explosions.wav",
    42.828271,
  ),
  item(
    "usc-g45-13",
    4,
    "Lancio siluro — impulso interno",
    "G45-13 · Submarine Torpedo Fire",
    "SILURI",
    "torpedo/g45-13-submarine-torpedo-fire.wav",
    10.025896,
  ),
  item(
    "usc-g45-14",
    5,
    "Esplosione del siluro",
    "G45-14 · Torpedo Explosion",
    "DANNO / ESPLOSIONI",
    "explosions/g45-14-torpedo-explosion.wav",
    18.240417,
  ),
  item(
    "usc-g45-16",
    6,
    "Compressore di bordo",
    "G45-16 · Submarine Compressor Motor",
    "MACCHINARI",
    "air/g45-16-submarine-compressor-motor.wav",
    29.071958,
  ),
  item(
    "usc-g45-20",
    7,
    "Motore del sommergibile sott’acqua",
    "G45-20 · Submarine Motor Underwater",
    "PROPULSIONE",
    "propulsion/g45-20-submarine-motor-underwater.wav",
    42.092062,
  ),
  item(
    "usc-g45-21",
    8,
    "Interno — ambiente generale",
    "G45-21 · Submarine Interior General",
    "INTERNI",
    "interior/g45-21-submarine-interior-general.wav",
    78.682042,
  ),
  item(
    "usc-g45-24",
    9,
    "Sala macchine — ambiente",
    "G45-24 · Submarine Interior Engine Room",
    "INTERNI",
    "interior/g45-24-submarine-interior-engine-room.wav",
    133.031937,
  ),
  item(
    "usc-g45-26",
    10,
    "Avviamento del motore",
    "G45-26 · Submarine Motor Start Up",
    "MACCHINARI",
    "propulsion/g45-26-submarine-motor-start-up.wav",
    76.425271,
  ),
  item(
    "usc-g45-28",
    11,
    "Annunciatore di bordo",
    "G45-28 · Submarine Annunciator",
    "INTERNI",
    "interior/g45-28-submarine-annunciator.wav",
    25.577,
  ),
  item(
    "usc-g45-30",
    12,
    "Apertura di un portello pesante",
    "G45-30 · Submarine Hatch Opening",
    "MECCANISMI",
    "submarine/g45-30-submarine-hatch-opening.wav",
    15.800625,
  ),
  item(
    "usc-g45-31",
    13,
    "Scia e turbolenza sott’acqua",
    "G45-31 · Submarine Churn Underwater",
    "PROPULSIONE",
    "propulsion/g45-31-submarine-churn-underwater.wav",
    21.789521,
  ),
  item(
    "usc-g45-33",
    14,
    "Sala siluri prodiera — ambiente",
    "G45-33 · Interior Forward Torpedo Room",
    "INTERNI",
    "interior/g45-33-interior-forward-torpedo-room.wav",
    23.78175,
  ),
  item(
    "usc-g45-34",
    15,
    "Lancio siluri — riverbero interno",
    "G45-34 · Reverberant Torpedos",
    "SILURI",
    "torpedo/g45-34-reverberant-torpedos.wav",
    127.768812,
  ),
  item(
    "usc-g45-35",
    16,
    "Esplosioni subacquee lontane",
    "G45-35 · Distant Explosions Underwater",
    "DANNO / ESPLOSIONI",
    "explosions/g45-35-distant-explosions-underwater.wav",
    103.470313,
  ),
  item(
    "usc-boats-blowers",
    17,
    "Ventilatori e voci in sala manovra",
    "SSE Boats · Blowers & Voices in Maneuvering Room",
    "INTERNI",
    "interior/boats-sub-blowers-and-voices.wav",
    42.705125,
  ),
  item(
    "usc-boats-periscope",
    18,
    "Periscopio — salita e discesa",
    "SSE Boats · Periscope Up and Down",
    "MECCANISMI",
    "submarine/boats-sub-periscope-up-down.wav",
    11.476625,
  ),
  item(
    "usc-boats-ballast-release",
    19,
    "Sfogo delle casse di zavorra",
    "SSE Boats · Submarine Ballast Release",
    "BALLAST / ARIA",
    "ballast/boats-sub-ballast-release.wav",
    7.249021,
  ),
  item(
    "usc-boats-ballast-explosive",
    20,
    "Soffiaggio casse — esplosivo",
    "SSE Boats · Ballast Tubes Blowing Out Explosively",
    "BALLAST / ARIA",
    "ballast/boats-sub-ballast-blow-explosive.wav",
    39.080729,
  ),
  item(
    "usc-boats-ballast-quick",
    21,
    "Soffiaggio casse — rapido",
    "SSE Boats · Ballast Tubes Blowing Out Quickly",
    "BALLAST / ARIA",
    "ballast/boats-sub-ballast-blow-quick.wav",
    8.952521,
  ),
  item(
    "usc-boats-ballast-normal",
    22,
    "Soffiaggio casse — normale",
    "SSE Boats · Ballast Tubes Blowing Out",
    "BALLAST / ARIA",
    "ballast/boats-sub-ballast-blow.wav",
    22.88575,
  ),
  item(
    "usc-boats-control-room",
    23,
    "Sala controllo — ambiente",
    "SSE Boats · Submarine Control Room",
    "INTERNI",
    "interior/boats-sub-control-room.wav",
    44.709375,
  ),
  item(
    "usc-boats-propeller",
    24,
    "Elica del sommergibile sott’acqua",
    "SSE Boats · Submarine Propeller Under Water",
    "PROPULSIONE",
    "propulsion/boats-sub-propeller-underwater.wav",
    4.992292,
  ),
  item(
    "usc-boats-torpedo-prop",
    25,
    "Siluro in corsa — elica pulsante",
    "SSE Boats · Torpedo Traveling / Popping Prop",
    "SILURI",
    "torpedo/boats-torpedo-traveling-popping-prop.wav",
    6.7,
  ),
  item(
    "usc-boats-prop-churn",
    26,
    "Elica e turbolenza del sommergibile",
    "SSE Boats · Submarine Prop Churning",
    "PROPULSIONE",
    "propulsion/boats-sub-prop-churning.wav",
    43.271229,
  ),
  item(
    "usc-metal-crusher",
    27,
    "Scafo — cigolii e lamenti brevi",
    "SSE Metal · Car Body Leaks and Moans",
    "SCAFO",
    "hull-stress/metal-car-crusher-leaks-moans.wav",
    25.750833,
  ),
  item(
    "usc-metal-girders",
    28,
    "Scafo — acciaio in torsione",
    "SSE Metal · Steel Girders Wrench and Tear",
    "SCAFO",
    "hull-stress/metal-steel-girders-wrench-tear.wav",
    53.813542,
  ),
  item(
    "usc-air-pressurized",
    29,
    "Aria pressurizzata",
    "Red Library · Pressurized Air",
    "BALLAST / ARIA",
    "air/r17-01-pressurized-air.wav",
    11.843917,
  ),
  item(
    "usc-air-compressed",
    30,
    "Aria o vapore compressi",
    "Red Library · Steam or Compressed Air",
    "BALLAST / ARIA",
    "air/r17-35-steam-or-compressed-air.wav",
    10.310021,
  ),
  item(
    "usc-air-blast-07",
    31,
    "Scariche d’aria — variante A",
    "Red Library R28-07 · Big Blasts of Air",
    "BALLAST / ARIA",
    "air/r28-07-big-blasts-of-air.wav",
    25.171063,
  ),
  item(
    "usc-air-blast-35",
    32,
    "Scariche d’aria — variante B",
    "Red Library R28-35 · Big Blasts of Air",
    "BALLAST / ARIA",
    "air/r28-35-big-blasts-of-air.wav",
    18.745313,
  ),
  item(
    "usc-air-blast-37",
    33,
    "Scariche d’aria — variante C",
    "Red Library R28-37 · Big Blasts of Air",
    "BALLAST / ARIA",
    "air/r28-37-big-blasts-of-air.wav",
    19.087937,
  ),
  item(
    "usc-water-big-flood",
    34,
    "Grande flooding",
    "SSE Water · Big Flood Waters",
    "FLOODING",
    "flooding/water-big-flood.wav",
    92,
  ),
  item(
    "usc-aircraft-atlas",
    35,
    "Lancio missile Atlas",
    "SSE Aircraft · Atlas Missile Launch",
    "MISSILI",
    "missile/aircraft-atlas-missile-launch.wav",
    65.271833,
  ),
  item(
    "usc-aircraft-titan",
    36,
    "Lancio missile Titan — lungo",
    "SSE Aircraft · Titan Missile Launch",
    "MISSILI",
    "missile/aircraft-titan-missile-launch-long.wav",
    140,
  ),
  item(
    "usc-aircraft-v2",
    37,
    "Accensione razzo V2",
    "SSE Aircraft · V2 Rocket Fires",
    "MISSILI",
    "missile/aircraft-v2-rocket-fires.wav",
    41.999979,
  ),
] as const satisfies readonly SfxAuditionItem[];

/** Source-level listening decision supplied by the user on 2026-08-18. */
export const SFX_APPROVED_ITEM_NUMBERS = Object.freeze([
  2, 3, 4, 5, 7, 11, 12, 13, 15, 16, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30,
  31, 32, 33, 34, 35, 36, 37,
] as const);

export const SFX_REJECTED_ITEM_NUMBERS = Object.freeze([
  1, 6, 8, 9, 10, 14, 17, 18, 23,
] as const);

const APPROVED_ITEM_NUMBER_SET = new Set<number>(SFX_APPROVED_ITEM_NUMBERS);
const REJECTED_ITEM_NUMBER_SET = new Set<number>(SFX_REJECTED_ITEM_NUMBERS);

export const SFX_AUDITION_DECISIONS: Readonly<
  Record<string, SfxAuditionDecision>
> = Object.freeze(
  Object.fromEntries(
    SFX_AUDITION_ITEMS.map((item) => {
      if (APPROVED_ITEM_NUMBER_SET.has(item.number)) {
        return [item.id, "keep"] as const;
      }
      if (REJECTED_ITEM_NUMBER_SET.has(item.number)) {
        return [item.id, "reject"] as const;
      }
      return [item.id, "undecided"] as const;
    }),
  ),
);

export function formatSfxAuditionReport(
  decisions: Readonly<Record<string, SfxAuditionDecision>>,
): string {
  const section = (heading: string, decision: SfxAuditionDecision): string => {
    const matchingItems = SFX_AUDITION_ITEMS.filter(
      ({ id }) => (decisions[id] ?? "undecided") === decision,
    );
    return [
      heading,
      ...(matchingItems.length === 0
        ? ["—"]
        : matchingItems.map(
            ({ number, title }) =>
              `${String(number).padStart(2, "0")} — ${title}`,
          )),
    ].join("\n");
  };

  return [
    "AKULA · SELEZIONE SFX 01–37",
    "",
    section("TIENI", "keep"),
    "",
    section("SCARTA", "reject"),
    "",
    section("INCERTI", "undecided"),
  ].join("\n");
}

function item(
  id: string,
  number: number,
  title: string,
  sourceTitle: string,
  category: string,
  relativePath: string,
  durationSeconds: number,
): SfxAuditionItem {
  return {
    id,
    number,
    title,
    sourceTitle,
    category,
    assetPath: `${RESEARCH_ROOT}/${relativePath}`,
    durationSeconds,
  };
}
