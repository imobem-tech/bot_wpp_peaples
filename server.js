import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';

import qrcode from 'qrcode-terminal';
import P from 'pino';

async function startBot() {

  const { state, saveCreds } = await useMultiFileAuthState('./sessions');

  const sock = makeWASocket({
    logger: P({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📲 Escaneie o QR Code abaixo:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;

      console.log('❌ Conexão fechada. Motivo:', reason);

      if (reason !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconectando...');
        startBot();
      } else {
        console.log('⚠️ Sessão encerrada. Apague /sessions e reconecte.');
      }
    }

    if (connection === 'open') {
      console.log('✅ WhatsApp conectado com sucesso!');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

startBot();
