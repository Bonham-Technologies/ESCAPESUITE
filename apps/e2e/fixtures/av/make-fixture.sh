#!/usr/bin/env bash
# Regenerates the A/V fixtures (ESCSUITE-348). Run from this directory:
#   bash make-fixture.sh
# Needs ffmpeg with libvpx-vp9, libopus, libx264 and the native AAC encoder.
set -euo pipefail

# 5 s of audio: a 440 Hz tone at 0.8 of full scale 0–2 s, digital silence
# 2–3 s, the tone again 3–5 s. (ffmpeg's `sine` source is fixed at 1/8 of full
# scale, too quiet to tell from silence on a 50 px waveform, hence aevalsrc.)
AUDIO="aevalsrc='if(between(t,2,3),0,0.8*sin(2*PI*440*t))':s=48000:d=5"
# 5 s of 640×360 testsrc2 at 30 fps: every frame differs, so a frozen preview
# shows, and it fills a third of a 1080p project's preview width.
VIDEO="testsrc2=size=640x360:rate=30:duration=5"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "$VIDEO" -f lavfi -i "$AUDIO" \
  -c:v libvpx-vp9 -b:v 200k -g 15 -deadline good -row-mt 1 \
  -c:a libopus -b:a 48k -ac 1 \
  -shortest tone-gap.webm

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "$VIDEO" -f lavfi -i "$AUDIO" \
  -c:v libx264 -pix_fmt yuv420p -profile:v baseline -b:v 200k -g 15 \
  -c:a aac -b:a 64k -ac 1 -movflags +faststart \
  -shortest tone-gap.mp4
