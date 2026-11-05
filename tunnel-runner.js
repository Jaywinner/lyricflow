const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function startTunnel() {
  console.log('[Tunnel] Starting localtunnel on port 3000...');
  const lt = spawn('cmd.exe', ['/c', 'npx', '--yes', 'localtunnel', '--port', '3000'], {
    shell: true,
    windowsHide: true
  });

  lt.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('[Tunnel output]:', text);
    const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/i);
    if (match) {
      const url = match[0];
      console.log('>>> ACTIVE PUBLIC HTTPS TUNNEL URL:', url);
      fs.writeFileSync(path.join(__dirname, 'tunnel.txt'), url, 'utf8');
    }
  });

  lt.stderr.on('data', (data) => {
    console.error('[Tunnel err]:', data.toString());
  });

  lt.on('close', (code) => {
    console.log(`[Tunnel] exited with code ${code}. Restarting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });
}

startTunnel();
