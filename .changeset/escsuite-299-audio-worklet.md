---
"@escapesuite/craft": patch
---

Recordings capture their sound through an AudioWorklet, so audio and video stay in sync however busy the page gets

A recording's sound used to be collected by a ScriptProcessorNode, whose callbacks run on the page's main thread: when the page was busy some of them never arrived, and ESCAPECRAFT had to estimate how much sound was missing and fill it with silence. Wherever the browser offers an AudioWorklet, the sound is now collected on the audio thread itself, which never skips a beat and records exactly where each piece of sound belongs — so nothing is lost, nothing has to be made up, and a pause leaves no gap or overlap in the audio. Browsers without an AudioWorklet, or that refuse to load it, keep the previous behaviour unchanged, and the browser console says once per recording which of the two was used.
