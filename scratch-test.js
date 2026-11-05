const { fpcalc } = require('gimme-the-song');
const path = require('path');
const fs = require('fs');

async function queryAcoustid(fingerprint, duration) {
  const clientKey = '8XaBELgH'; // Standard public AcoustID client key
  const url = `https://api.acoustid.org/v2/lookup?client=${clientKey}&meta=recordings+releasegroups+compress&fingerprint=${encodeURIComponent(fingerprint)}&duration=${duration}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log('AcoustID Response:', JSON.stringify(data).slice(0, 300));
}

console.log('AcoustID query function ready');
