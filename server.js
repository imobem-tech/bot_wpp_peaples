import express from "express";
import QRCode from "qrcode";
import P from "pino";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

const app = express();
const PORT = process.env.PORT || 8080;

let sock = null;
let qrAtual = null;
let conectado = false;
let ultimaAtualizacao = null;

const AUTH_DIR = process.env.AUTH_DIR || "./sessions";

async function iniciarBot() {
  console.log("🚀 Iniciando bot WhatsApp...");

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "22.04.4"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    ultimaAtualizacao = new Date().toISOString();

    if (qr) {
      conectado = false;
      qrAtual = await QRCode.toDataURL(qr);
      console.log("📲 QR_GERADO - acesse /qr");
    }

    if (connection === "open") {
      conectado = true;
      qrAtual = null;
      console.log("✅ WhatsApp conectado!");
    }

    if (connection === "close") {
      conectado = false;

      const statusCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode;

      console.log("❌ Conexão fechada. Código:", statusCode);

      if (statusCode === 405) {
        console.log("⚠️ Erro 405: sessão inválida ou rejeitada.");
        console.log("👉 Troque AUTH_DIR para uma pasta nova, ex: /app/sessions/peaples_04");
        qrAtual = null;
        return;
      }

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconectando em 5 segundos...");
        setTimeout(iniciarBot, 5000);
      } else {
        console.log("⚠️ Sessão deslogada. Será necessário escanear novo QR.");
      }
    }
  });
}

app.get("/", (req, res) => {
  res.send("Bot WhatsApp Peaples online ✅");
});

app.get("/status", (req, res) => {
  res.json({
    online: true,
    whatsappConectado: conectado,
    qrDisponivel: !!qrAtual,
    ultimaAtualizacao,
    authDir: AUTH_DIR
  });
});

app.get("/qr", (req, res) => {
  if (conectado) {
    return res.send("<h1>WhatsApp já conectado ✅</h1>");
  }

  if (!qrAtual) {
    return res.send("<h1>QR ainda não gerado. Aguarde e atualize a página.</h1>");
  }

  res.send(`
    <html>
      <head>
        <title>QR WhatsApp</title>
        <meta http-equiv="refresh" content="10">
      </head>
      <body style="font-family: Arial; text-align: center; padding-top: 40px;">
        <h1>Escaneie o QR Code</h1>
        <img src="${qrAtual}" style="width:320px;height:320px;" />
        <p>Esta página atualiza automaticamente.</p>
      </body>
    </html>
  `);
});

app.get("/reset", async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }

    conectado = false;
    qrAtual = null;

    res.send("Sessão encerrada. Reinicie o serviço para gerar novo QR.");
  } catch (err) {
    res.status(500).send("Erro ao resetar sessão: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  iniciarBot();
});
