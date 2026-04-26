import express from "express";
import QRCode from "qrcode";
import P from "pino";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { uploadArquivo } from "./r2.js";

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from "@whiskeysockets/baileys";

const app = express();
const PORT = process.env.PORT || 8080;

let sock = null;
let qrAtual = null;
let conectado = false;
let iniciando = false;
let ultimaAtualizacao = null;

const AUTH_DIR = process.env.AUTH_DIR || "/app/sessions/peaples_04";

async function iniciarBot() {
  if (iniciando) return;
  iniciando = true;

  console.log("🚀 Iniciando bot WhatsApp...");

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.macOS("Desktop"),
      logger: P({ level: "silent" }),
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      ultimaAtualizacao = new Date().toISOString();

      console.log("🔥 UPDATE:", {
        connection,
        qr: qr ? "QR_GERADO" : undefined,
        statusCode,
        error: lastDisconnect?.error?.message
      });

      if (qr) {
        qrAtual = await QRCode.toDataURL(qr);
        conectado = false;
      }

      if (connection === "open") {
        console.log("✅ WhatsApp conectado!");
        conectado = true;
        qrAtual = null;
      }

      if (connection === "close") {
        conectado = false;
        iniciando = false;

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          qrAtual = null;
          console.log("⚠️ Sessão deslogada. Use AUTH_DIR novo se precisar gerar QR limpo.");
          return;
        }

        if (statusCode === 405) {
          qrAtual = null;
          console.log("⚠️ 405 detectado. Sessão/pareamento rejeitado. Use AUTH_DIR novo.");
          return;
        }

        setTimeout(iniciarBot, 8000);
      }
    });
  } catch (err) {
    console.error("💥 Erro ao iniciar bot:", err);
    iniciando = false;
    setTimeout(iniciarBot, 8000);
  }
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
  if (conectado) return res.send("<h1>WhatsApp já conectado ✅</h1>");

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

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  iniciarBot();
});
