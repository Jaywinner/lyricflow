# 🎵 LyricFlow — Live Music Recognition & Synced Auto-Scrolling Lyrics

**LyricFlow** is a Shazam-like music identification application combined with an Apple Music / Spotify-style auto-scrolling synchronized lyrics engine. It listens to music playing in the environment (or through audio playback), identifies the song, extracts the exact timestamp offset, retrieves synchronized lyrics, and auto-scrolls down line-by-line in real-time as the song plays!

---

## ✨ Features

- 🎙️ **Live Microphone Recognition**:
  - Tap the pulsating concentric sonic orb to capture 5–7 seconds of ambient music playing in your room or on your phone.
  - Real-time Web Audio API spectrum equalizer visualizer with dynamic gradients.
  - Uses free Shazam-compatible recognition with AcoustID/Chromaprint fallback.
  - Automatically identifies the song and playback timecode offset.

- 📜 **Time-Synchronized Auto-Scrolling Lyrics**:
  - Powered by **LRCLIB** (open-source synced lyrics database) with millisecond-precision timestamps.
  - Current singing line is prominently highlighted in glowing crisp text with smooth scaling.
  - Smooth automatic vertical auto-scroll keeping the active verse centered on screen.
  - Preceding lyrics gently fade out while upcoming lyrics are legible.
  - **Manual Scroll Awareness**: If you scroll away to read ahead, a floating *"Follow current lyric"* button appears to snap you back.

- ⏱️ **Real-Time Music Tracking & Calibration**:
  - Ticks in real-time from the recognition timecode.
  - One-tap Nudge calibration buttons (`-0.5s` / `+0.5s`) to fine-tune synchronization if ambient audio recognition has room delay.
  - Click on **any lyric line** to jump the timeline directly to that part of the song!

- ⚡ **Instant Demos & Global Search**:
  - Search any song title or artist in the world to immediately retrieve synced lyrics, high-res album artwork, and audio preview.
  - Instant demo buttons (e.g., *Blinding Lights*, *Bohemian Rhapsody*, *Flowers*, *Someone Like You*, *Yellow*, *Stay*) for one-click testing without needing music playing right away.

- 🎤 **Fullscreen Karaoke Mode**:
  - Toggle with one click or press `F` for an immersive party sing-along display with giant typography and dynamic ambient background lighting.

---

## 🚀 How to Run

1. Open your terminal in this directory:
   ```bash
   cd C:\Users\DELL\.gemini\antigravity\scratch\lyricflow
   ```

2. Start the local server:
   ```bash
   npm start
   ```

3. Open your browser:
   ```
   http://localhost:3000
   ```

4. Click **"TAP TO LISTEN"** while a song plays on your phone, speaker, or another tab. The track is identified and lyrics begin at the detected playback position.
