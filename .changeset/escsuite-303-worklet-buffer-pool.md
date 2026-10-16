---
"@escapesuite/craft": patch
---

Recording sound no longer creates fresh memory on the audio thread for every piece of sound

The AudioWorklet that collects a recording's sound used to make two new buffers for every ~85 ms piece of sound it handed to the page, leaving about 32 KB to be cleaned up on the audio thread itself several times a second for as long as the recording ran — and cleanup on that thread is one of the things that can cause an audible glitch. The page now hands each piece's buffers back once it has encoded them, and the audio thread reuses them, keeping at most four pairs in reserve, so a recording in progress makes no new buffers there at all unless the page falls more than four pieces behind. What is recorded is unchanged.
