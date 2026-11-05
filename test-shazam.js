const { recognizeBytes } = require('shazamio-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const fs = require('fs');
const os = require('os');
const path = require('path');

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }).toUpperCase();
}

async function convertBufferToWav(buffer, ext = 'webm') {
  const tempInput = path.join(os.tmpdir(), `test_in_${Date.now()}.${ext}`);
  const tempOutput = path.join(os.tmpdir(), `test_out_${Date.now()}.wav`);
  fs.writeFileSync(tempInput, buffer);

  return new Promise((resolve, reject) => {
    ffmpeg(tempInput)
      .toFormat('wav')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('end', () => {
        try { fs.unlinkSync(tempInput); } catch (_) {}
        try {
          const outBuf = fs.readFileSync(tempOutput);
          fs.unlinkSync(tempOutput);
          resolve(outBuf);
        } catch (e) {
          reject(e);
        }
      })
      .on('error', (err) => {
        try { fs.unlinkSync(tempInput); } catch (_) {}
        try { fs.unlinkSync(tempOutput); } catch (_) {}
        reject(err);
      })
      .run();
  });
}

async function queryShazam(signatureUri, samplems) {
  const tagId = uuidv4();
  const reqId = uuidv4();
  const url = `https://amp.shazam.com/discovery/v5/en/US/iphone/-/tag/${tagId}/${reqId}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`;

  const payload = {
    timezone: 'America/New_York',
    signature: {
      uri: signatureUri,
      samplems: samplems
    },
    timestamp: Date.now(),
    context: {},
    geolocation: {}
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': 'Shazam/15.0.0 (iPhone; iOS 15.0; Scale/3.00)',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return await res.json();
}

async function run() {
  const previewUrl = 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/d1/2f/3d/d12f3d43-a2e2-eba4-8db5-91f3f3c13f5a/mzaf_8470584399239689698.plus.aac.p.m4a';
  console.log('Preview URL:', previewUrl);

  const audioRes = await fetch(previewUrl);
  const audioBuf = Buffer.from(await audioRes.arrayBuffer());
  console.log('Downloaded audio bytes:', audioBuf.length);

  console.log('Converting to 16kHz mono WAV...');
  const wavBuf = await convertBufferToWav(audioBuf, 'm4a');
  console.log('WAV buffer bytes:', wavBuf.length);

  console.log('Generating Shazam signatures...');
  const signatures = recognizeBytes(wavBuf);
  console.log('Generated signatures count:', signatures.length);

  if (signatures.length > 0) {
    const sig = signatures[0];
    console.log(`Samplems: ${sig.samplems}, num_samples: ${sig.number_samples}`);
    console.log('Querying amp.shazam.com...');
    const result = await queryShazam(sig.uri, sig.samplems);
    console.log('Shazam match found:');
    console.log('Track title:', result.track ? result.track.title : 'No track');
    console.log('Artist:', result.track ? result.track.subtitle : 'No artist');
    console.log('Matches length:', result.matches ? result.matches.length : 0);
    if (result.matches && result.matches.length > 0) {
      console.log('Match offset / timecode info:', JSON.stringify(result.matches[0]));
    }
  }

  for (const s of signatures) s.free();
}

run().catch(console.error);
