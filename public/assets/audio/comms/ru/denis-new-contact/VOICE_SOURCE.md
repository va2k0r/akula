# Russian sonar contact voice

The audio clips in this directory were generated offline on 2026-08-16 with
the Piper `ru_RU-denis-medium` neural voice.

- Voice model: https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU/denis/medium
- Dataset license: CC0
- Runtime: Piper; used only during asset generation and not distributed with
  the game
- Sample rate: 22,050 Hz mono
- Delivery format: AAC-LC in an M4A container

The runtime assembles a report from one opening, exactly three live bearing
digits, and the fixed target designation. The first acquired contact always
uses the complete opening:

`Центральный, акустики. Шум винтов, пеленг ноль четыре семь. Цель номер один.`

Most later acquisitions use the shorter opening, while occasional reports
repeat the complete form:

`Шум винтов. Пеленг ноль четыре семь. Цель номер один.`

The spoken digits are selected at runtime, so `ноль четыре семь` is an example
rather than a hard-coded bearing. `contact-first.m4a`, `contact-repeat.m4a`, and
`target-one.m4a` contain the new fixed portions. The older `new-contact.m4a`
and sentence-final digit variants remain only as legacy source material and are
not loaded by the prototype.

English meaning:

`Central, sonar. Propeller noise, bearing zero four seven. Target number one.`
