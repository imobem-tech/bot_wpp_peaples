
console.log("ENV CHECK:", {
  endpoint: process.env.R2_ENDPOINT,
  key: process.env.R2_ACCESS_KEY_ID,
  bucket: process.env.R2_BUCKET
});

import fs from "fs";

fs.rmSync("./sessions", { recursive: true, force: true });
console.log("🧹 Sessão apagada");

import express from "express";
import QRCode from "qrcode";
import P from "pino";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import { uploadArquivo } from "./r2.js";

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

  // 🔌 STATUS DE CONEXÃO
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
        console.log("⚠️ Sessão inválida — gerar novo QR");
        qrAtual = null;
        return;
      }

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconectando...");
        setTimeout(iniciarBot, 5000);
      } else {
        console.log("⚠️ Sessão deslogada.");
      }
    }
  });

  // 📩 CAPTURA DE MENSAGENS (AQUI ESTÁ O OURO)
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const tipo = Object.keys(msg.message)[0];

    console.log("📨 Tipo:", tipo);

    try {
      // 📌 TEXTO
      if (tipo === "conversation") {
        console.log("💬 Texto:", msg.message.conversation);
      }

      // 📌 MÍDIAS
      if (
        tipo === "imageMessage" ||
        tipo === "audioMessage" ||
        tipo === "videoMessage" ||
        tipo === "documentMessage"
      ) {
        const buffer = await downloadMediaMessage(
          msg,
          "buffer",
          {},
          { logger: P({ level: "silent" }) }
        );

        const nomeArquivo = `${Date.now()}-${tipo}`;

        const url = await uploadArquivo(
          buffer,
          nomeArquivo,
          "application/octet-stream"
        );

        console.log("📁 Upload R2:", url);
      }
    } catch (err) {
      console.log("❌ Erro mídia:", err);
    }
  });
}

// 🌐 ROTAS
app.get("/", (req, res) => {
  res.send("Bot WhatsApp online ✅");
});

app.get("/status", (req, res) => {
  res.json({
    online: true,
    whatsappConectado: conectado,
    qrDisponivel: !!qrAtual,
    ultimaAtualizacao
  });
});

app.get("/qr", (req, res) => {
  if (conectado) {
    return res.send("<h1>WhatsApp já conectado ✅</h1>");
  }

  if (!qrAtual) {
    return res.send("<h1>Aguarde QR...</h1>");
  }

  res.send(`
    <html>
      <body style="text-align:center;">
        <h1>Escaneie o QR</h1>
        <img src="${qrAtual}" width="300"/>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 Rodando na porta ${PORT}`);
  iniciarBot();
});
