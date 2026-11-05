const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Shazam } = require('unofficial-shazam');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for handling in-memory audio uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Helper: Parse LRC format string into structured array of objects
function parseLRC(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for metadata like [ti:...], [ar:...], ignore them
    if (/^\[(ti|ar|al|by|offset|length):/i.test(trimmed)) {
      continue;
    }

    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length > 0) {
      const text = trimmed.replace(timeRegex, '').trim();
      for (const match of matches) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const msStr = match[3] || '00';
        const ms = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
        const totalSeconds = min * 60 + sec + ms / 1000;
        result.push({
          time: parseFloat(totalSeconds.toFixed(2)),
          text: text
        });
      }
    }
  }

  // Sort chronologically
  result.sort((a, b) => a.time - b.time);
  return result;
}

function cleanTitle(t) {
  if (!t) return '';
  return t
    .replace(/\s*\(.*?(remix|feat|version|deluxe|remastered|explicit|audio|video|official).*?\)/gi, '')
    .replace(/\s*\[.*?(remix|feat|version|deluxe|remastered|explicit|audio|video|official).*?\]/gi, '')
    .replace(/\s*-\s*(remix|remastered|deluxe|single|radio edit).*$/gi, '')
    .trim();
}

function cleanArtist(a) {
  if (!a) return '';
  return a.split(/&|,|\bfeat\.?\b|\bft\.?\b/i)[0].trim();
}

// Helper: Query LRCLIB for synced lyrics
async function fetchSyncedLyrics(trackName, artistName, duration = null) {
  const attempts = [
    { track: trackName, artist: artistName },
    { track: cleanTitle(trackName), artist: cleanArtist(artistName) },
    { track: cleanTitle(trackName), artist: '' }
  ];

  for (const attempt of attempts) {
    if (!attempt.track) continue;
    try {
      let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(attempt.track)}`;
      if (attempt.artist) {
        url += `&artist_name=${encodeURIComponent(attempt.artist)}`;
      }
      if (duration) {
        url += `&duration=${Math.round(duration)}`;
      }

      const res = await fetch(url, {
        headers: { 'User-Agent': 'LyricFlow-App/1.0.0 (https://github.com/lyricflow)' }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.syncedLyrics) {
          return {
            syncedLyrics: data.syncedLyrics,
            parsedLyrics: parseLRC(data.syncedLyrics),
            plainLyrics: data.plainLyrics || '',
            source: 'lrclib_exact'
          };
        } else if (data.plainLyrics) {
          return {
            syncedLyrics: null,
            parsedLyrics: [],
            plainLyrics: data.plainLyrics,
            source: 'lrclib_plain'
          };
        }
      }
    } catch (err) {
      console.warn(`Exact attempt failed for ${attempt.track}:`, err.message);
    }
  }

  // Try search queries on LRCLIB
  const searchQueries = [
    `${trackName} ${artistName}`,
    `${cleanTitle(trackName)} ${cleanArtist(artistName)}`,
    cleanTitle(trackName)
  ];

  for (const q of searchQueries) {
    if (!q.trim()) continue;
    try {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q.trim())}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': 'LyricFlow-App/1.0.0 (https://github.com/lyricflow)' }
      });

      if (searchRes.ok) {
        const list = await searchRes.json();
        if (Array.isArray(list) && list.length > 0) {
          const matchWithSynced = list.find(item => item.syncedLyrics);
          if (matchWithSynced && matchWithSynced.syncedLyrics) {
            return {
              syncedLyrics: matchWithSynced.syncedLyrics,
              parsedLyrics: parseLRC(matchWithSynced.syncedLyrics),
              plainLyrics: matchWithSynced.plainLyrics || '',
              source: 'lrclib_search'
            };
          }
          if (list[0].plainLyrics) {
            return {
              syncedLyrics: null,
              parsedLyrics: [],
              plainLyrics: list[0].plainLyrics,
              source: 'lrclib_search_plain'
            };
          }
        }
      }
    } catch (err) {
      console.warn('LRCLIB search attempt error:', err.message);
    }
  }

  return { syncedLyrics: null, parsedLyrics: [], plainLyrics: '', source: 'none' };
}

// Helper: Query iTunes for artwork & 30-sec preview audio
async function fetchItunesMetadata(trackName, artistName) {
  try {
    const query = `${trackName} ${artistName}`.trim();
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=5`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        // Find close match
        const item = data.results[0];
        const artwork = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : null;
        return {
          artwork,
          previewUrl: item.previewUrl || null,
          trackViewUrl: item.trackViewUrl || null,
          collectionName: item.collectionName || '',
          durationSec: item.trackTimeMillis ? item.trackTimeMillis / 1000 : null
        };
      }
    }
  } catch (err) {
    console.error('iTunes fetch error:', err.message);
  }
  return { artwork: null, previewUrl: null, trackViewUrl: null, collectionName: '', durationSec: null };
}

// AcoustID Fingerprinting & Lookup
async function recognizeWithAcoustID(audioBuffer) {
  return new Promise((resolve) => {
    try {
      const { execFile } = require('child_process');
      const fpcalcExe = path.join(__dirname, 'node_modules', 'gimme-the-song', 'fpcalc', 'fpcalc.exe');
      
      if (!fs.existsSync(fpcalcExe)) {
        console.warn('[AcoustID] fpcalc.exe not found at:', fpcalcExe);
        return resolve(null);
      }

      const tempPath = path.join(os.tmpdir(), `sample_${Date.now()}.webm`);
      fs.writeFileSync(tempPath, audioBuffer);

      execFile(fpcalcExe, [tempPath, '-json'], async (err, stdout, stderr) => {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
        if (err || !stdout) {
          console.warn('[AcoustID fpcalc error]', (err && err.message) || stderr);
          return resolve(null);
        }

        try {
          const parsed = JSON.parse(stdout);
          if (!parsed.fingerprint) return resolve(null);

          const clientKey = process.env.ACOUSTID_CLIENT_KEY || '8XaBELgH';
          const url = `https://api.acoustid.org/v2/lookup?client=${clientKey}&meta=recordings+releasegroups+compress&fingerprint=${encodeURIComponent(parsed.fingerprint)}&duration=${Math.floor(parsed.duration)}`;
          const res = await fetch(url);
          if (!res.ok) {
            console.warn('[AcoustID lookup error]', res.status, res.statusText);
            return resolve(null);
          }
          const data = await res.json();

          if (data.status === 'ok' && data.results && data.results.length > 0) {
            for (const r of data.results) {
              if (r.recordings && r.recordings.length > 0) {
                const rec = r.recordings[0];
                const title = rec.title;
                const artist = rec.artists && rec.artists.length > 0 ? rec.artists[0].name : '';
                if (title) {
                  return resolve({ title, artist });
                }
              }
            }
          }
        } catch (e) {
          console.error('[AcoustID parse/fetch error]', e.message);
        }
        resolve(null);
      });
    } catch (err) {
      console.error('[AcoustID exec error]', err.message);
      resolve(null);
    }
  });
}

async function recognizeWithShazam(audioBuffer) {
  const tempInput = path.join(os.tmpdir(), `shazam_${Date.now()}.webm`);
  const tempWav = path.join(os.tmpdir(), `shazam_${Date.now()}.wav`);
  fs.writeFileSync(tempInput, audioBuffer);

  try {
    await new Promise((resolve, reject) => {
      const ffmpeg = require('fluent-ffmpeg');
      const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
      ffmpeg.setFfmpegPath(ffmpegInstaller.path);
      ffmpeg(tempInput)
        .toFormat('wav')
        .audioFrequency(16000)
        .audioChannels(1)
        .on('end', resolve)
        .on('error', reject)
        .save(tempWav);
    });

    const result = await new Shazam('America/New_York').recognise(tempWav, 'en-US');
    const match = result && result.matches && result.matches[0];
    if (!result || !result.track || !match) return null;

    const track = result.track;
    const songSection = track.sections && track.sections.find(section => section.type === 'SONG');
    const album = songSection && songSection.metadata
      ? songSection.metadata.find(item => item.title === 'Album')
      : null;
    const timecode = Number(match.offset ?? match.timeSkew ?? match.timecode);

    return {
      title: track.title,
      artist: track.subtitle,
      album: album ? album.text : 'Single',
      timecode: Number.isFinite(timecode) ? Math.max(0, timecode) : 0,
      timecodeAvailable: Number.isFinite(timecode)
    };
  } catch (err) {
    console.warn('[Shazam recognition failed]', err.message);
    return null;
  } finally {
    for (const file of [tempInput, tempWav]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (err) {
        console.warn('[Recognition cleanup failed]', err.message);
      }
    }
  }
}

// POST /api/recognize: Identify music from recorded microphone audio with AcoustID
app.post('/api/recognize', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    console.log(`[Audio Recognition] Received audio buffer: ${req.file.size} bytes (${req.file.mimetype})`);

    const shazamMatch = await recognizeWithShazam(req.file.buffer);
    const acoustidMatch = shazamMatch || await recognizeWithAcoustID(req.file.buffer);
    if (!acoustidMatch || !acoustidMatch.title) {
      return res.json({
        recognized: false,
        message: 'No match found. Try a clearer or longer audio sample.'
      });
    }

    console.log(`[${shazamMatch ? 'Shazam' : 'AcoustID'} Success] Identified: "${acoustidMatch.title}" by "${acoustidMatch.artist}"`);
    const itunesData = await fetchItunesMetadata(acoustidMatch.title, acoustidMatch.artist);
    const lyricsData = await fetchSyncedLyrics(acoustidMatch.title, acoustidMatch.artist, itunesData.durationSec);

    return res.json({
      recognized: true,
      provider: shazamMatch ? 'Shazam-compatible recognition' : 'AcoustID (Free Open Source)',
      title: acoustidMatch.title,
      artist: acoustidMatch.artist,
      album: itunesData.collectionName || acoustidMatch.album || 'Single',
      artwork: itunesData.artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
      timecode: acoustidMatch.timecode || 0,
      timecodeAvailable: acoustidMatch.timecodeAvailable === true,
      captureDuration: Number(req.body.captureDuration) || 0,
      lyrics: lyricsData.parsedLyrics,
      rawLrc: lyricsData.syncedLyrics,
      plainLyrics: lyricsData.plainLyrics,
      previewUrl: itunesData.previewUrl,
      duration: itunesData.durationSec || 200,
      appleMusicUrl: itunesData.trackViewUrl
    });
  } catch (err) {
    console.error('Recognition error:', err);
    res.status(500).json({ error: 'Recognition failed', message: err.message });
  }
});

// GET /api/search: Search for a track and retrieve synced lyrics
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required.' });

    // Step 1: Query iTunes for match
    const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=6`);
    const itunesData = await itunesRes.json();

    if (!itunesData.results || itunesData.results.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const item = itunesData.results[0];
    const title = item.trackName;
    const artist = item.artistName;
    const album = item.collectionName;
    const duration = item.trackTimeMillis ? item.trackTimeMillis / 1000 : 210;
    const artwork = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : null;

    // Step 2: Query LRCLIB for synced lyrics
    const lyricsData = await fetchSyncedLyrics(title, artist, duration);

    res.json({
      title,
      artist,
      album,
      artwork: artwork || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
      previewUrl: item.previewUrl,
      duration,
      lyrics: lyricsData.parsedLyrics,
      rawLrc: lyricsData.syncedLyrics,
      plainLyrics: lyricsData.plainLyrics,
      appleMusicUrl: item.trackViewUrl
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lyrics: Direct LRCLIB lookup
app.get('/api/lyrics', async (req, res) => {
  const { track, artist, duration } = req.query;
  if (!track || !artist) {
    return res.status(400).json({ error: 'Parameters track and artist are required.' });
  }

  const result = await fetchSyncedLyrics(track, artist, duration ? parseFloat(duration) : null);
  res.json(result);
});

// GET /api/demos: Curated list of popular songs with guaranteed synced lyrics and preview audio
app.get('/api/demos', async (req, res) => {
  const demoList = [
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    { title: 'Bohemian Rhapsody', artist: 'Queen' },
    { title: 'Flowers', artist: 'Miley Cyrus' },
    { title: 'Someone Like You', artist: 'Adele' },
    { title: 'Yellow', artist: 'Coldplay' },
    { title: 'Stay', artist: 'The Kid LAROI & Justin Bieber' },
    { title: 'Shape of You', artist: 'Ed Sheeran' }
  ];

  res.json(demoList);
});

// GET /api/network-info: Return URLs for phone access
app.get('/api/network-info', (req, res) => {
  const os = require('os');
  let localIp = '127.0.0.1';
  const ifaces = os.networkInterfaces();
  for (let dev in ifaces) {
    for (let details of ifaces[dev]) {
      if (details.family === 'IPv4' && !details.internal && !details.address.startsWith('169.254')) {
        localIp = details.address;
        break;
      }
    }
  }

  let tunnelUrl = process.env.TUNNEL_URL || '';
  try {
    const fs = require('fs');
    if (fs.existsSync(path.join(__dirname, 'tunnel.txt'))) {
      const saved = fs.readFileSync(path.join(__dirname, 'tunnel.txt'), 'utf8').trim();
      if (saved) tunnelUrl = saved;
    }
  } catch (e) {}

  res.json({
    localIp,
    localUrl: `http://${localIp}:${PORT}`,
    tunnelUrl,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(tunnelUrl)}`
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LyricFlow server running on http://0.0.0.0:${PORT}`);
});
