/* Proxy TCP com atraso fixo por sentido — simula latência de rede real
   entre a página (porta listen) e o servidor do jogo (porta target). */
'use strict';
const net = require('node:net');

function createLagProxy({ targetPort, listenPort, delayMs }) {
  const server = net.createServer(client => {
    const up = net.connect(targetPort, '127.0.0.1');
    const kill = () => { client.destroy(); up.destroy(); };
    client.on('data', d => setTimeout(() => { if (up.writable) up.write(d); }, delayMs));
    up.on('data', d => setTimeout(() => { if (client.writable) client.write(d); }, delayMs));
    client.on('error', kill); up.on('error', kill);
    client.on('close', kill); up.on('close', kill);
  });
  return new Promise(res => server.listen(listenPort, '127.0.0.1',
    () => res({ close: () => server.close() })));
}

module.exports = { createLagProxy };
