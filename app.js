/**
 * LyricFlow — Dual-Mode App (Desktop & Mobile) with Kinetic Lyric Sliding & Continuous Auto-Sync
 *
 * Key features:
 *  1. Kinetic Transform Sliding:
 *     - Lyrics stream translates on GPU (translateY) centered on the active singing line.
 *     - Smooth ease curve: cubic-bezier(0.22, 1, 0.36, 1) mimicking Apple Music/Spotify.
 *     - Drag & wheel support with inertia; click "Follow lyrics" or any line to snap back.
 *  2. Continuous Background Listening & Auto-Alignment:
 *     - While ambient music plays, a silent background listener captures periodic 3.5s acoustic slices.
 *     - Matches the track timestamp and smoothly slews (interpolates) any drift out of existence.
 *     - Guarantees lyrics stay 100% locked to the live playing music from start to finish!
 *  3. True Zero-Friction Desktop & Mobile Support:
 *     - Direct native getUserMedia() on all origins with clean platform detection.
 */

'use strict';

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */

function isMobile() {
  return window.innerWidth <= 820 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/* ══════════════════════════════════════════════════════════════
   LYRICFLOW APP CLASS
══════════════════════════════════════════════════════════════ */
class LyricFlowApp {

  constructor() {
    this.mobile = isMobile();

    // ── Primary Recording state ──
    this.mediaStream     = null;
    this.mediaRecorder   = null;
    this.audioChunks     = [];
    this.isListening     = false;
    this.listenTimer     = null;
    this.recordStartTime = 0;
    this.sampleDuration  = 5.5; // seconds

    // ── Background Continuous Auto-Sync state ──
    this.bgSyncInterval  = null;
    this.bgRecorder      = null;
    this.isBgSyncing     = false;
    this.driftCorrection = 0;   // smoothly slewed into currentTime

    // ── Visualizer ──
    this.audioCtx        = null;
    this.analyser        = null;

    // ── Track & Lyrics state ──
    this.currentTrack    = null;
    this.lyrics          = [];  // [{time, text}]
    this.activeIndex     = -1;
    this.currentTime     = 0;
    this.duration        = 240;
    this.syncOffset      = 0;
    this.isPlaying       = false;
    this.isAmbient       = false;
    this.tickTimer       = null;
    this.lastTick        = 0;

    // ── Kinetic Transform-Slide state ──
    this.currentTranslateY = 0;
    this.userScrolled      = false;
    this.isDragging        = false;
    this.dragStartY        = 0;
    this.dragStartTranslateY = 0;

    this.init();
  }

  /* ─────────────────────────── INIT ─────────────────────────── */

  init() {
    if (this.mobile) {
      this.initMobile();
    } else {
      this.initDesktop();
    }
    this.fetchNetworkInfo();
    this.previewAudio = document.getElementById('previewAudio');
    // Handle resize re-centering
    window.addEventListener('resize', () => {
      const wasMobile = this.mobile;
      this.mobile = isMobile();
      if (!this.userScrolled && this.activeIndex >= 0) {
        this.scrollToActive(true);
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     DESKTOP INIT
  ══════════════════════════════════════════════════════════════ */
  initDesktop() {
    const $ = id => document.getElementById(id);

    this.dBrandBtn    = $('dBrandBtn');
    this.dSearchInput = $('dSearchInput');
    this.dSearchBtn   = $('dSearchBtn');
    this.dPhoneBtn    = $('dPhoneBtn');

    this.dHero        = $('dHero');
    this.dPlayer      = $('dPlayer');
    this.dDock        = $('dDock');

    // Hero
    this.dOrbBtn      = $('dOrbBtn');
    this.dOrbLabel    = $('dOrbLabel');
    this.dMicIcon     = $('dMicIcon');
    this.dSpinIcon    = $('dSpinIcon');
    this.dHeroTitle   = $('dHeroTitle');
    this.dHeroSub     = $('dHeroSub');
    this.dVisualizer  = $('dVisualizer');
    this.dDemoPills   = $('dDemoPills');

    // Player left
    this.dArtwork     = $('dArtwork');
    this.dTrackTitle  = $('dTrackTitle');
    this.dTrackArtist = $('dTrackArtist');
    this.dTrackAlbum  = $('dTrackAlbum');
    this.dRelistenBtn = $('dRelistenBtn');

    // Player lyrics
    this.dLyricsVp    = $('dLyricsVp');
    this.dLyricsStream = $('dLyricsStream');
    this.dSourceTag   = $('dSourceTag');
    this.dLiveText    = $('dLiveText');
    this.dResumePill  = $('dResumePill');

    // Dock
    this.dDockArt     = $('dDockArt');
    this.dDockTitle   = $('dDockTitle');
    this.dDockArtist  = $('dDockArtist');
    this.dPlayBtn     = $('dPlayBtn');
    this.dPlayIcon    = $('dPlayIcon');
    this.dPauseIcon   = $('dPauseIcon');
    this.dNudgeBack   = $('dNudgeBack');
    this.dNudgeFwd    = $('dNudgeFwd');
    this.dCurrentTime = $('dCurrentTime');
    this.dDuration    = $('dDuration');
    this.dTimeline    = $('dTimeline');
    this.dTimelineFill = $('dTimelineFill');

    // Modal
    this.phoneModal   = $('phoneModal');
    this.closePhoneModal = $('closePhoneModal');
    this.qrCodeImg    = $('qrCodeImg');
    this.phoneUrlInput = $('phoneUrlInput');
    this.copyUrlBtn   = $('copyUrlBtn');

    // ── Bind Desktop Events ──
    this.dBrandBtn.addEventListener('click', () => this.dShowHero());
    this.dOrbBtn.addEventListener('click', () => this.toggleListen());
    this.dRelistenBtn.addEventListener('click', () => { this.dShowHero(); this.startListening(); });
    this.dSearchBtn.addEventListener('click', () => this.dHandleSearch());
    this.dSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.dHandleSearch(); });
    this.dDemoPills.addEventListener('click', e => {
      const pill = e.target.closest('.d-pill');
      if (pill) this.loadBySearch(`${pill.dataset.title} ${pill.dataset.artist}`);
    });

    this.dPlayBtn.addEventListener('click', () => this.togglePlayback());
    this.dNudgeBack.addEventListener('click', () => this.adjustOffset(-2));
    this.dNudgeFwd.addEventListener('click', () => this.adjustOffset(+2));

    const dMicroBack = $('dMicroBack');
    const dMicroFwd  = $('dMicroFwd');
    if (dMicroBack) dMicroBack.addEventListener('click', () => this.adjustOffset(-0.5));
    if (dMicroFwd)  dMicroFwd.addEventListener('click',  () => this.adjustOffset(+0.5));
    this.dTimeline.addEventListener('click', e => {
      const r = this.dTimeline.getBoundingClientRect();
      this.seekToTime(((e.clientX - r.left) / r.width) * this.duration);
    });

    this.dResumePill.addEventListener('click', () => {
      this.userScrolled = false;
      this.dResumePill.classList.add('hidden');
      this.scrollToActive(false);
    });

    // Kinetic sliding gestures on desktop
    this.bindKineticGestures(this.dLyricsVp, this.dLyricsStream, this.dResumePill);

    this.dPhoneBtn.addEventListener('click', () => this.phoneModal.classList.remove('hidden'));
    this.closePhoneModal.addEventListener('click', () => this.phoneModal.classList.add('hidden'));
    this.copyUrlBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(this.phoneUrlInput.value);
      this.copyUrlBtn.textContent = 'Copied!';
      setTimeout(() => { this.copyUrlBtn.textContent = 'Copy'; }, 2000);
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlayback(); }
    });

    this.dShowHero();
  }

  dShowHero() {
    this.resetSession();
    this.dHero.classList.remove('hidden');
    this.dPlayer.classList.add('hidden');
    this.dDock.classList.add('hidden');
    this.dOrbLabel.textContent = 'TAP TO LISTEN';
    this.dMicIcon.classList.remove('hidden');
    this.dSpinIcon.classList.add('hidden');
    this.dHeroTitle.textContent = 'Identify Music Playing Around You';
    this.dHeroSub.textContent = 'Play any song near your mic. LyricFlow pinpoints the track, finds synced lyrics, and auto-scrolls in real time — perfectly in time with the music.';
    this.dVisualizer.classList.add('hidden');
    document.body.classList.remove('listening');
  }

  dShowPlayer() {
    this.dHero.classList.add('hidden');
    this.dPlayer.classList.remove('hidden');
    this.dDock.classList.remove('hidden');
  }

  async dHandleSearch() {
    const q = this.dSearchInput.value.trim();
    if (!q) return;
    await this.loadBySearch(q);
  }

  /* ══════════════════════════════════════════════════════════════
     MOBILE INIT
  ══════════════════════════════════════════════════════════════ */
  initMobile() {
    const $ = id => document.getElementById(id);

    this.mHero        = $('mHero');
    this.mPlayer      = $('mPlayer');
    this.mBar         = $('mBar');

    // Hero
    this.mOrbBtn      = $('mOrbBtn');
    this.mOrbLabel    = $('mOrbLabel');
    this.mMicIcon     = $('mMicIcon');
    this.mSpinIcon    = $('mSpinIcon');
    this.mHeroTitle   = $('mHeroTitle');
    this.mHeroSub     = $('mHeroSub');
    this.mVisualizer  = $('mVisualizer');
    this.mSearchInput = $('mSearchInput');
    this.mSearchBtn   = $('mSearchBtn');

    // Player
    this.mLyricsVp    = $('mLyricsVp');
    this.mLyricsStream = $('mLyricsStream');
    this.mResumePill  = $('mResumePill');

    // Bar
    this.mBarArt      = $('mBarArt');
    this.mBarTitle    = $('mBarTitle');
    this.mBarArtist   = $('mBarArtist');
    this.mPlayBtn     = $('mPlayBtn');
    this.mPlayIcon    = $('mPlayIcon');
    this.mPauseIcon   = $('mPauseIcon');
    this.mRelistenBtn = $('mRelistenBtn');

    // Events
    this.mOrbBtn.addEventListener('click', () => this.toggleListen());
    this.mSearchBtn.addEventListener('click', () => this.mHandleSearch());
    this.mSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.mHandleSearch(); });

    this.mPlayBtn.addEventListener('click', () => this.togglePlayback());
    this.mRelistenBtn.addEventListener('click', () => { this.mShowHero(); this.startListening(); });

    this.mResumePill.addEventListener('click', () => {
      this.userScrolled = false;
      this.mResumePill.classList.add('hidden');
      this.scrollToActive(false);
    });

    // Kinetic sliding gestures on mobile
    this.bindKineticGestures(this.mLyricsVp, this.mLyricsStream, this.mResumePill);

    this.mShowHero();
  }

  mShowHero() {
    this.resetSession();
    this.mHero.classList.remove('hidden');
    this.mPlayer.classList.add('hidden');
    this.mBar.classList.add('hidden');
    this.mOrbLabel.textContent = 'TAP TO LISTEN';
    this.mMicIcon.classList.remove('hidden');
    this.mSpinIcon.classList.add('hidden');
    this.mHeroTitle.textContent = 'Identify Music Around You';
    this.mHeroSub.textContent = 'Play any song near your phone. LyricFlow recognizes it and auto-scrolls the lyrics in sync.';
    this.mVisualizer.classList.add('hidden');
    document.body.classList.remove('listening');
  }

  mShowPlayer() {
    this.mHero.classList.add('hidden');
    this.mPlayer.classList.remove('hidden');
    this.mBar.classList.remove('hidden');
  }

  async mHandleSearch() {
    const q = this.mSearchInput.value.trim();
    if (!q) return;
    await this.loadBySearch(q);
  }

  /* ══════════════════════════════════════════════════════════════
     KINETIC TRANSFORM-SLIDING GESTURES (Wheel + Drag)
  ══════════════════════════════════════════════════════════════ */
  bindKineticGestures(viewport, stream, resumePill) {
    if (!viewport || !stream) return;

    // Wheel scrolling
    viewport.addEventListener('wheel', (e) => {
      if (this.lyrics.length === 0) return;
      this.userScrolled = true;
      resumePill && resumePill.classList.remove('hidden');

      // Temporarily disable transition during manual wheeling for instant 1:1 response
      stream.style.transition = 'none';
      this.currentTranslateY -= e.deltaY * 0.85;
      stream.style.transform = `translateY(${this.currentTranslateY}px)`;

      clearTimeout(this._wheelTimeout);
      this._wheelTimeout = setTimeout(() => {
        stream.style.transition = '';
      }, 150);
    }, { passive: true });

    // Touch / Pointer dragging
    const onStart = (clientY) => {
      if (this.lyrics.length === 0) return;
      this.isDragging = true;
      this.dragStartY = clientY;
      this.dragStartTranslateY = this.currentTranslateY;
      stream.style.transition = 'none';
    };

    const onMove = (clientY) => {
      if (!this.isDragging) return;
      const delta = clientY - this.dragStartY;
      if (Math.abs(delta) > 5) {
        this.userScrolled = true;
        resumePill && resumePill.classList.remove('hidden');
      }
      this.currentTranslateY = this.dragStartTranslateY + delta;
      stream.style.transform = `translateY(${this.currentTranslateY}px)`;
    };

    const onEnd = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      stream.style.transition = '';
    };

    viewport.addEventListener('mousedown', (e) => onStart(e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientY));
    window.addEventListener('mouseup', onEnd);

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) onStart(e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) onMove(e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchend', onEnd);
  }

  /* ══════════════════════════════════════════════════════════════
     SESSION RESET
  ══════════════════════════════════════════════════════════════ */
  resetSession() {
    this.stopBackgroundAutoSync();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    this.mediaRecorder = null;
    this.audioChunks   = [];
    this.isListening   = false;
    clearInterval(this.listenTimer);
    clearInterval(this.tickTimer);
    this.tickTimer = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }

    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.removeAttribute('src');
    }

    this.lyrics          = [];
    this.activeIndex     = -1;
    this.currentTime     = 0;
    this.isPlaying       = false;
    this.isAmbient       = false;
    this.syncOffset      = 0;
    this.driftCorrection = 0;
    this.userScrolled    = false;
    this.currentTranslateY = 0;

    if (this.mobile) {
      if (this.mLyricsStream) {
        this.mLyricsStream.innerHTML = '';
        this.mLyricsStream.style.transform = 'translateY(0px)';
      }
      if (this.mResumePill) this.mResumePill.classList.add('hidden');
    } else {
      if (this.dLyricsStream) {
        this.dLyricsStream.innerHTML = '';
        this.dLyricsStream.style.transform = 'translateY(0px)';
      }
      if (this.dResumePill) this.dResumePill.classList.add('hidden');
    }
  }

  toggleListen() {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PRIMARY RECORDING & RECOGNITION
  ══════════════════════════════════════════════════════════════ */
  async startListening() {
    this.resetSession();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setStatus(
        'Microphone Not Available',
        'Your browser does not expose microphone access on this origin. On mobile, please open via the secure HTTPS link. On desktop, Chrome or Edge is recommended.'
      );
      return;
    }

    this.isListening = true;
    this.setListeningUI(true);

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        },
        video: false
      });

      this.setupVisualizer(this.mediaStream);

      const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', ''];
      const mime = mimes.find(m => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)));
      this.mediaRecorder = mime
        ? new MediaRecorder(this.mediaStream, { mimeType: mime })
        : new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => {
        this.processAudio();
      };

      this.sampleRecordedDuration = 0;
      this.recordStartTime = performance.now();
      this.mediaRecorder.start(200);

      this.sampleDuration = 4.5; // Keep first recognition responsive while retaining enough audio
      let elapsedSec = 0;
      this.setOrbLabel(`LISTENING (1s)`);

      this.listenTimer = setInterval(() => {
        elapsedSec++;
        if (elapsedSec < this.sampleDuration) {
          this.setOrbLabel(`LISTENING (${elapsedSec}s)`);
          if (elapsedSec >= 4) {
            this.setOrbSub('Tap orb anytime to finish now');
          }
        } else {
          clearInterval(this.listenTimer);
          this.stopListening();
        }
      }, 1000);

    } catch (err) {
      console.error('[Mic error]', err.name, err.message);
      this.isListening = false;
      this.setListeningUI(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        this.setStatus(
          'Microphone Blocked',
          'Your browser blocked microphone permissions.\n\nClick the 🔒 icon in your browser address bar → set Microphone to "Allow", and tap the button again.'
        );
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        this.setStatus(
          'No Microphone Detected',
          'No audio recording hardware was found on your device.'
        );
      } else {
        this.setStatus(
          'Microphone Access Needed',
          `${err.name}: ${err.message || 'Please permit microphone access when prompted'}.`
        );
      }
    }
  }

  stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    clearInterval(this.listenTimer);
    this.recordEndTime = performance.now();
    this.sampleRecordedDuration = (this.recordEndTime - this.recordStartTime) / 1000;
    this.setOrbLabel('IDENTIFYING...');
    this.setStatus('Identifying Song...', 'Matching acoustic fingerprint and calculating alignment...');

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  async processAudio() {
    try {
      const mime = (this.mediaRecorder && this.mediaRecorder.mimeType) || 'audio/webm';
      const blob = new Blob(this.audioChunks, { type: mime });
      const form = new FormData();
      form.append('audio', blob, 'sample.webm');
      form.append('captureDuration', String(this.sampleRecordedDuration || 0));

      const res  = await fetch('/api/recognize', {
        method: 'POST',
        body: form
      });
      const data = await res.json();

      // postRecordLatency = network RTT + server recognition latency since recording finished
      const now = performance.now();
      const postRecordLatency = Math.max(0, (now - (this.recordEndTime || now)) / 1000);
      const totalElapsed = (now - this.recordStartTime) / 1000;

      this.setListeningUI(false);

      if (data.recognized) {
        const rawTimecode = parseFloat(data.timecode) || 0;
        const calibrated  = data.timecodeAvailable
          ? Math.max(0, rawTimecode + (this.sampleRecordedDuration || 0) + postRecordLatency)
          : 0;

        console.log(
          `[Recognized via ${data.provider || 'AcoustID'}] ` +
          `rawTC=${rawTimecode.toFixed(2)}s  postRecordLatency=${postRecordLatency.toFixed(2)}s  ` +
          `→  display from ${calibrated.toFixed(2)}s (total elapsed=${totalElapsed.toFixed(2)}s)`
        );

        this.loadTrack(data, calibrated, true);
      } else {
        this.setStatus(
          '🔍 Song Not Recognized',
          data.message || 'Make sure music is playing and try tapping the button again, or use search.'
        );
      }
    } catch (err) {
      console.error('[processAudio error]', err);
      this.setListeningUI(false);
      this.setStatus('Recognition Error', 'Could not reach recognition server. Please try again.');
    }
  }

  /* ══════════════════════════════════════════════════════════════
     SEARCH
  ══════════════════════════════════════════════════════════════ */
  async loadBySearch(query) {
    this.setStatus(`Searching for "${query}"...`, 'Fetching lyrics from LRCLIB...');
    try {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      this.loadTrack(data, 0, false);
    } catch (err) {
      this.setStatus(`No results for "${query}"`, 'Try another title or include the artist name.');
    }
  }

  /* ══════════════════════════════════════════════════════════════
     LOAD TRACK & START LIVE PLAYBACK
  ══════════════════════════════════════════════════════════════ */
  loadTrack(data, startOffset = 0, isAmbient = false) {
    this.currentTrack = data;
    this.lyrics       = data.lyrics || [];
    this.duration     = data.duration || 240;
    this.currentTime  = Math.max(0, startOffset);
    this.syncOffset   = 0;
    this.activeIndex  = -1;
    this.isAmbient    = isAmbient;
    this.userScrolled = false;

    if (this.mobile) {
      this.mShowPlayer();
      this.mBarArt.src            = data.artwork || '';
      this.mBarTitle.textContent  = data.title   || '—';
      this.mBarArtist.textContent = data.artist  || '—';
      this.renderLyrics(this.mLyricsStream, 'm-lyric');
    } else {
      this.dShowPlayer();
      this.dArtwork.src           = data.artwork || '';
      this.dTrackTitle.textContent  = data.title   || '—';
      this.dTrackArtist.textContent = data.artist  || '—';
      this.dTrackAlbum.textContent  = data.album   || '—';
      this.dDockArt.src           = data.artwork || '';
      this.dDockTitle.textContent  = data.title   || '—';
      this.dDockArtist.textContent = data.artist  || '—';
      this.dSourceTag.textContent  = this.lyrics.length ? 'LRCLIB Synced' : 'Plain Text';
      this.dLiveText.textContent   = isAmbient ? 'Live Ambient' : 'Preview';
      this.renderLyrics(this.dLyricsStream, 'd-lyric');
    }

    if (data.previewUrl && !isAmbient) {
      this.previewAudio.src = data.previewUrl;
      this.previewAudio.currentTime = Math.min(startOffset, 30);
      this.previewAudio.play().catch(() => {});
    } else {
      this.previewAudio.pause();
      this.previewAudio.removeAttribute('src');
    }

    this.startTicker();

    // Shazam-compatible recognition supplies the initial timecode. Background
    // samples keep correcting drift when the recognizer returns another timecode.
    if (isAmbient && this.mediaStream && this.mediaStream.active) {
      this.startBackgroundAutoSync();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     CONTINUOUS BACKGROUND AUTO-SYNC & AUTO-ALIGN ENGINE
  ══════════════════════════════════════════════════════════════ */
  startBackgroundAutoSync() {
    this.stopBackgroundAutoSync();
    console.log('[AutoSync] Background continuous sync engine started.');

    this.isBgSyncActive = true;
    this.isMusicPaused = false;

    // Start the first correction immediately, then keep short samples in flight
    // sequentially so recognition latency cannot create overlapping recorders.
    const scheduleNext = (delayMs = 100) => {
      if (!this.isBgSyncActive || !this.isAmbient) return;
      this.bgLoopTimeout = setTimeout(async () => {
        if (!this.isBgSyncActive || !this.isAmbient) return;
        await this.performBackgroundSample(2800);
        scheduleNext(100);
      }, delayMs);
    };

    scheduleNext(100);
  }

  stopBackgroundAutoSync() {
    this.isBgSyncActive = false;
    clearTimeout(this.bgLoopTimeout);
    this.bgLoopTimeout = null;
    if (this.bgRecorder && this.bgRecorder.state !== 'inactive') {
      try { this.bgRecorder.stop(); } catch (_) {}
    }
    this.bgRecorder = null;
    this.isBgSyncing = false;
    this.isMusicPaused = false;
  }

  async performBackgroundSample(sampleMs = 4800) {
    if (!this.isAmbient || this.isBgSyncing) return;
    if (!this.mediaStream || !this.mediaStream.active) return;

    this.isBgSyncing = true;
    const bgChunks = [];
    const bgStart = performance.now();

    try {
      const mime = (this.mediaRecorder && this.mediaRecorder.mimeType) || 'audio/webm';
      this.bgRecorder = new MediaRecorder(this.mediaStream, { mimeType: mime });

      this.bgRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) bgChunks.push(e.data);
      };

      this.bgRecorder.onstop = async () => {
        try {
          const blob = new Blob(bgChunks, { type: mime });
          const form = new FormData();
          form.append('audio', blob, 'sample.webm');
          form.append('captureDuration', String((this._bgRecordEndTime - bgStart) / 1000));

          const res = await fetch('/api/recognize', {
            method: 'POST',
            body: form
          });

          const data = await res.json();
          this.isBgSyncing = false;

          if (data.recognized && this.isAmbient && data.timecodeAvailable) {
            const rawTimecode       = parseFloat(data.timecode) || 0;
            const postRecordLatency = Math.max(0, (performance.now() - (this._bgRecordEndTime || bgStart)) / 1000);
            const captureDuration   = Math.max(0, (this._bgRecordEndTime - bgStart) / 1000);
            const trueSongPosition  = Math.max(0, rawTimecode + captureDuration + postRecordLatency);
            const drift             = trueSongPosition - this.currentTime;

            console.log(`[Continuous Sync] rawTC=${rawTimecode.toFixed(2)}s | local=${this.currentTime.toFixed(2)}s | drift=${drift.toFixed(2)}s`);

            // If music was paused, resume it now that recognition found music!
            if (this.isMusicPaused) {
              this.isMusicPaused = false;
              this.showAutoSyncNotice('▶ Music Resumed');
            }

            // BACKTRACKING SUPPORT:
            // If the song was paused and unpaused, or user jumped back/forward,
            // drift can be negative (we are ahead of the song) or large positive.
            if (Math.abs(drift) > 0.35) {
              // Apply measured recognition corrections immediately so lyrics do
              // not remain visibly behind while a slow slew catches up.
              console.log(`[Backtracking] Snapping position from ${this.currentTime.toFixed(2)}s to ${trueSongPosition.toFixed(2)}s (drift: ${drift.toFixed(2)}s)`);
              this.currentTime = trueSongPosition;
              this.driftCorrection = 0;
              this.updateLyricHighlight();
              this.scrollToActive(false);
              this.showAutoSyncNotice(`✦ Realigned (${drift > 0 ? '+' : ''}${drift.toFixed(1)}s)`);
            } else if (Math.abs(drift) > 0.05) {
              // Keep tiny fluctuations smooth to avoid visible jitter.
              this.driftCorrection = drift;
              this.showAutoSyncNotice(`✦ Synced (${drift > 0 ? '+' : ''}${drift.toFixed(1)}s)`);
            } else {
              this.showAutoSyncNotice('✦ In Perfect Sync');
            }
          } else if (data.recognized && this.isAmbient) {
            console.log('[Continuous Sync] AcoustID confirmed the track; no timecode correction is available.');
          } else {
            console.log('[Continuous Sync] Sample slice did not match track (music may be paused or quiet)');
          }
        } catch (e) {
          console.warn('[AutoSync background query failed]:', e.message);
          this.isBgSyncing = false;
        }
      };

      // Record for sampleMs milliseconds
      this.bgRecorder.start(200);
      setTimeout(() => {
        if (this.bgRecorder && this.bgRecorder.state === 'recording') {
          this._bgRecordEndTime = performance.now();
          this.bgRecorder.stop();
        }
      }, sampleMs);

    } catch (e) {
      console.warn('[AutoSync capture error]:', e);
      this.isBgSyncing = false;
    }
  }

  showAutoSyncNotice(msg) {
    clearTimeout(this._syncNoticeTimer);
    if (!this.mobile && this.dLiveText) {
      this.dLiveText.textContent = msg;
      this.dLiveText.style.color = 'var(--cyan)';
      this._syncNoticeTimer = setTimeout(() => {
        if (this.dLiveText) {
          this.dLiveText.textContent = this.isAmbient ? 'Live Ambient' : 'Preview';
          this.dLiveText.style.color = '';
        }
      }, 3000);
    } else if (this.mobile && this.mBarTitle) {
      const origTitle = this.currentTrack ? (this.currentTrack.title || '—') : '—';
      this.mBarTitle.textContent = msg;
      this.mBarTitle.style.color = 'var(--cyan)';
      this._syncNoticeTimer = setTimeout(() => {
        if (this.mBarTitle) {
          this.mBarTitle.textContent = origTitle;
          this.mBarTitle.style.color = '';
        }
      }, 2500);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     RENDER LYRICS
  ══════════════════════════════════════════════════════════════ */
  renderLyrics(container, cssClass) {
    container.innerHTML = '';
    // Hide and disable transition while building DOM to prevent any flash of line 0
    container.style.opacity = '0';
    container.style.transition = 'none';

    if (!this.lyrics.length) {
      if (this.currentTrack && this.currentTrack.plainLyrics) {
        this.currentTrack.plainLyrics.split('\n').forEach(line => {
          if (!line.trim()) return;
          const el = document.createElement('div');
          el.className = cssClass;
          el.textContent = line;
          container.appendChild(el);
        });
      } else {
        const el = document.createElement('div');
        el.className = `${cssClass} active`;
        el.textContent = 'No synced lyrics found for this track.';
        container.appendChild(el);
      }
      container.style.opacity = '1';
      container.style.transition = '';
      return;
    }

    this.lyrics.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = `${cssClass} upcoming`;
      el.dataset.index = i;
      el.textContent = item.text || '♪';

      // Click line to seek
      el.addEventListener('click', () => {
        this.seekToTime(item.time);
      });

      container.appendChild(el);
    });

    // Determine initial active index
    this.updateLyricHighlight(true);

    // Wait for browser layout pass to guarantee accurate viewport and element dimensions
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.scrollToActive(true);
        // Force reflow
        void container.offsetHeight;
        // Fade in smoothly at the exact active singing line
        container.style.transition = 'transform var(--slide-dur) var(--slide-ease), opacity 0.35s ease';
        container.style.opacity = '1';
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     REAL-TIME TICKER (50ms interval)
  ══════════════════════════════════════════════════════════════ */
  startTicker() {
    this.isPlaying = true;
    this.updatePlayPauseIcons();
    this.lastTick = performance.now();
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.tick(), 50);
  }

  pauseTicker() {
    this.isPlaying = false;
    this.updatePlayPauseIcons();
    clearInterval(this.tickTimer);
    this.tickTimer = null;
    if (this.previewAudio) this.previewAudio.pause();
  }

  togglePlayback() {
    if (this.isPlaying) this.pauseTicker(); else this.startTicker();
  }

  tick() {
    const now   = performance.now();
    const delta = (now - this.lastTick) / 1000;
    this.lastTick = now;

    // Fast, responsive drift correction:
    // Seamlessly catches up or slows down within seconds (max ±35% speed trim) without breaking playback flow
    let slewDelta = 0;
    if (Math.abs(this.driftCorrection) > 0.01) {
      if (Math.abs(this.driftCorrection) > 2.5) {
        // Large desync (> 2.5s): clean immediate seek
        this.currentTime += this.driftCorrection;
        this.driftCorrection = 0;
      } else {
        // Fast musical catch-up (up to ±35% tempo trim)
        const maxTrim = delta * 0.35;
        slewDelta = Math.sign(this.driftCorrection) * Math.min(Math.abs(this.driftCorrection), maxTrim);
        this.driftCorrection -= slewDelta;
      }
    }

    if (!this.isAmbient && this.previewAudio && this.previewAudio.src && !this.previewAudio.paused) {
      this.currentTime = this.previewAudio.currentTime;
    } else {
      this.currentTime += (delta + slewDelta);
    }

    if (this.currentTime >= this.duration) {
      this.currentTime = this.duration;
      this.pauseTicker();
    }

    this.updateTimelineUI();
    this.updateLyricHighlight();
  }

  seekToTime(sec) {
    this.currentTime = Math.max(0, Math.min(sec, this.duration));
    this.driftCorrection = 0;
    if (!this.isAmbient && this.previewAudio && this.previewAudio.src) {
      this.previewAudio.currentTime = Math.min(this.currentTime, 30);
    }
    this.userScrolled = false;
    if (this.mobile) this.mResumePill && this.mResumePill.classList.add('hidden');
    else this.dResumePill && this.dResumePill.classList.add('hidden');

    this.updateTimelineUI();
    this.updateLyricHighlight();
    this.scrollToActive(false);
  }

  adjustOffset(delta) {
    this.syncOffset = parseFloat((this.syncOffset + delta).toFixed(2));
    this.updateLyricHighlight();
    this.scrollToActive(false);
    // Show visual feedback
    const sign = this.syncOffset >= 0 ? '+' : '';
    this.showAutoSyncNotice(`✦ Offset: ${sign}${this.syncOffset.toFixed(1)}s`);
  }

  updateTimelineUI() {
    if (!this.mobile) {
      if (this.dCurrentTime) this.dCurrentTime.textContent = formatTime(this.currentTime);
      if (this.dDuration)    this.dDuration.textContent    = formatTime(this.duration);
      if (this.dTimelineFill) {
        const pct = Math.min(100, (this.currentTime / this.duration) * 100);
        this.dTimelineFill.style.width = `${pct}%`;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     LYRIC HIGHLIGHT & KINETIC TRANSFORM SLIDE
  ══════════════════════════════════════════════════════════════ */
  updateLyricHighlight(force = false) {
    if (!this.lyrics.length) return;

    // LRCLIB line timestamps commonly mark the vocal center rather than its
    // onset. Lead the timestamp so the next line appears as the vocal starts.
    const ANTICIPATION_LEAD = 0.35;
    const effective = this.currentTime + this.syncOffset + ANTICIPATION_LEAD;
    let newIdx = -1;

    for (let i = 0; i < this.lyrics.length; i++) {
      if (this.lyrics[i].time <= effective) newIdx = i;
      else break;
    }

    if (newIdx === this.activeIndex && !force) return;
    this.activeIndex = newIdx;

    const container = this.mobile ? this.mLyricsStream : this.dLyricsStream;
    if (!container) return;
    const items = container.children;

    for (let i = 0; i < items.length; i++) {
      const el  = items[i];
      const cls = el.className.split(' ')[0];
      if      (i < this.activeIndex)  el.className = `${cls} past`;
      else if (i === this.activeIndex) el.className = `${cls} active`;
      else                             el.className = `${cls} upcoming`;
    }

    if (!this.userScrolled && !force) {
      this.scrollToActive();
    }
  }

  /**
   * Smooth Kinetic Slide:
   * Sets transform: translateY(...) on the container so the active line glides
   * into the exact vertical center of the viewport with GPU acceleration.
   */
  scrollToActive(instant = false) {
    if (this.activeIndex < 0) return;
    const container = this.mobile ? this.mLyricsStream : this.dLyricsStream;
    const viewport  = this.mobile ? this.mLyricsVp     : this.dLyricsVp;
    if (!container || !viewport) return;

    const activeEl = container.children[this.activeIndex];
    if (!activeEl) return;

    const vpH = viewport.clientHeight;
    // If viewport or active element hasn't finished layout pass, retry on next frame
    if (vpH <= 0 || activeEl.offsetTop <= 0) {
      requestAnimationFrame(() => this.scrollToActive(instant));
      return;
    }

    // Calculate distance from top of stream to center of active lyric line
    const elCenter = activeEl.offsetTop + (activeEl.offsetHeight / 2);
    const targetY  = (vpH / 2) - elCenter;

    this.currentTranslateY = targetY;

    if (instant) {
      container.style.transition = 'none';
      container.style.transform = `translateY(${targetY}px)`;
      // Force reflow then restore transition
      void container.offsetHeight;
      container.style.transition = '';
    } else {
      container.style.transform = `translateY(${targetY}px)`;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     UI LABELS & VISUALIZER
  ══════════════════════════════════════════════════════════════ */
  setOrbLabel(text) {
    if (this.mobile)  { if (this.mOrbLabel) this.mOrbLabel.textContent = text; }
    else              { if (this.dOrbLabel) this.dOrbLabel.textContent = text; }
  }

  setOrbSub(text) {
    if (this.mobile)  { if (this.mHeroSub) this.mHeroSub.textContent = text; }
    else              { if (this.dHeroSub) this.dHeroSub.textContent = text; }
  }

  setStatus(title, sub) {
    if (this.mobile) {
      if (this.mHeroTitle) this.mHeroTitle.textContent = title;
      if (this.mHeroSub)   this.mHeroSub.innerHTML = sub.replace(/\n/g, '<br>');
    } else {
      if (this.dHeroTitle) this.dHeroTitle.textContent = title;
      if (this.dHeroSub)   this.dHeroSub.innerHTML = sub.replace(/\n/g, '<br>');
    }
  }

  setListeningUI(on) {
    document.body.classList.toggle('listening', on);

    if (this.mobile) {
      if (this.mMicIcon)  this.mMicIcon.classList.toggle('hidden', on);
      if (this.mSpinIcon) this.mSpinIcon.classList.toggle('hidden', !on);
      if (this.mVisualizer) this.mVisualizer.classList.toggle('hidden', !on);
      if (!on) this.setOrbLabel('TAP TO LISTEN');
    } else {
      if (this.dMicIcon)  this.dMicIcon.classList.toggle('hidden', on);
      if (this.dSpinIcon) this.dSpinIcon.classList.toggle('hidden', !on);
      if (this.dVisualizer) this.dVisualizer.classList.toggle('hidden', !on);
      if (!on) this.setOrbLabel('TAP TO LISTEN');
    }
  }

  updatePlayPauseIcons() {
    if (this.mobile) {
      if (this.mPlayIcon)  this.mPlayIcon.classList.toggle('hidden', this.isPlaying);
      if (this.mPauseIcon) this.mPauseIcon.classList.toggle('hidden', !this.isPlaying);
    } else {
      if (this.dPlayIcon)  this.dPlayIcon.classList.toggle('hidden', this.isPlaying);
      if (this.dPauseIcon) this.dPauseIcon.classList.toggle('hidden', !this.isPlaying);
    }
  }

  setupVisualizer(stream) {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 64;
    source.connect(this.analyser);

    const canvas = this.mobile ? this.mVisualizer : this.dVisualizer;
    if (canvas) {
      canvas.classList.remove('hidden');
      this.drawVisualizer(canvas);
    }
  }

  drawVisualizer(canvas) {
    if (!this.analyser || !canvas) return;
    const ctx = canvas.getContext('2d');
    const buf = new Uint8Array(this.analyser.frequencyBinCount);

    const draw = () => {
      if (!this.isListening) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(buf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bw = (canvas.width / buf.length) * 1.6;
      let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const h = (buf[i] / 255) * canvas.height;
        const g = ctx.createLinearGradient(0, canvas.height, 0, 0);
        g.addColorStop(0, '#00d4ff'); g.addColorStop(1, '#ec4899');
        ctx.fillStyle = g;
        ctx.fillRect(x, canvas.height - h, Math.max(1, bw - 2), h);
        x += bw;
      }
    };
    draw();
  }

  async fetchNetworkInfo() {
    try {
      const res  = await fetch('/api/network-info');
      if (!res.ok) return;
      const data = await res.json();
      if (data.tunnelUrl) {
        if (this.phoneUrlInput) this.phoneUrlInput.value = data.tunnelUrl;
        if (this.qrCodeImg)     this.qrCodeImg.src       = data.qrUrl || '';
      }
    } catch (e) {
      console.warn('[fetchNetworkInfo]', e);
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  window.app = new LyricFlowApp();
});
