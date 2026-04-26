import express from "express";
import QRCode from "qrcode";
import P from "pino";
import fs from "fs";

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  downloadMediaMessage
} from "@whiskeysockets/baileys";

import { uploadArquivo } from "./r2.js";
import { salvarConversa, salvarMensagem } from "./db_wpp.js";

const app = express();
const PORT = process.env.PORT || 8080;

const AUTH_DIR = process.env.AUTH_DIR || "/app/sessions/peaples_06";

let sock = null;
let qrAtual = null;
let conectado = false;
let iniciando = false;
let ultimaAtualizacao = null;
let reset405Tentado = false;

function conferirEnv() {
  console.log("ENV CHECK:", {
    authDir: AUTH_DIR,
    bucket: process.env.R2_BUCKET || "FALTANDO",
    endpoint: process.env.R2_ENDPOINT ? "OK" : "FALTANDO",
    accessKey: process.env.R2_ACCESS_KEY_ID ? "OK" : "FALTANDO",
    secretKey: process.env.R2_SECRET_ACCESS_KEY ? "OK" : "FALTANDO",
    database: process.env.DATABASE_URL ? "OK" : "FALTANDO"
  });
}

function apagarSessao() {
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log("🧹 Sessão apagada:", AUTH_DIR);
  } catch (err) {
    console.log("⚠️ Erro ao apagar sessão:", err.message);
  }
}

function obterTipoMensagem(msg) {
  if (!msg?.message) return null;

  const m = msg.message;

  if (m.conversation) return "conversation";
  if (m.extendedTextMessage) return "extendedTextMessage";
  if (m.imageMessage) return "imageMessage";
  if (m.audioMessage) return "audioMessage";
  if (m.videoMessage) return "videoMessage";
  if (m.documentMessage) return "documentMessage";
  if (m.stickerMessage) return "stickerMessage";

  return Object.keys(m)[0];
}

function obterTextoMensagem(msg) {
  const m = msg.message || {};

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  );
}

function obterTimestampWhatsapp(msg) {
  const ts = msg.messageTimestamp;

  if (!ts) return new Date();

  const segundos =
    typeof ts === "object" && typeof ts.toNumber === "function"
      ? ts.toNumber()
      : Number(ts);

  return new Date(segundos * 1000);
}

function montarNomeArquivo(msg, tipo) {
  const remoteJid = msg.key?.remoteJid || "desconhecido";
  const cleanJid = remoteJid.replace(/[^a-zA-Z0-9]/g, "_");

  let ext = "bin";

  if (tipo === "imageMessage") ext = "jpg";
  if (tipo === "audioMessage") ext = "ogg";
  if (tipo === "videoMessage") ext = "mp4";
  if (tipo === "stickerMessage") ext = "webp";

  if (tipo === "documentMessage") {
    const fileName = msg.message?.documentMessage?.fileName || "";
    ext = fileName.includes(".") ? fileName.split(".").pop() : "bin";
  }

  return `wpp/${cleanJid}/${Date.now()}-${tipo}.${ext}`;
}

function obterContentType(msg, tipo) {
  if (tipo === "imageMessage") return msg.message.imageMessage.mimetype || "image/jpeg";
  if (tipo === "audioMessage") return msg.message.audioMessage.mimetype || "audio/ogg";
  if (tipo === "videoMessage") return msg.message.videoMessage.mimetype || "video/mp4";
  if (tipo === "documentMessage") return msg.message.documentMessage.mimetype || "application/octet-stream";
  if (tipo === "stickerMessage") return msg.message.stickerMessage.mimetype || "image/webp";

  return "application/octet-stream";
}

function obterNomeOriginalArquivo(msg, tipo, nomeR2) {
  if (tipo === "documentMessage") {
    return msg.message?.documentMessage?.fileName || nomeR2.split("/").pop();
  }

  return nomeR2.split("/").pop();
}

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
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      ultimaAtualizacao = new Date().toISOString();

      const statusCode =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode;

      console.log("🔥 UPDATE:", {
        connection,
        qr: qr ? "QR_GERADO" : undefined,
        statusCode,
        error: lastDisconnect?.error?.message
      });

      if (qr) {
        conectado = false;
        qrAtual = await QRCode.toDataURL(qr);
        console.log("📲 QR_GERADO - acesse /qr");
      }

      if (connection === "open") {
        conectado = true;
        qrAtual = null;
        iniciando = false;
        reset405Tentado = false;
        console.log("✅ WhatsApp conectado!");
      }

      if (connection === "close") {
        conectado = false;
        iniciando = false;

        console.log("❌ Conexão fechada. Código:", statusCode);

        if (statusCode === 405) {
          console.log("⚠️ Sessão inválida.");

          if (!reset405Tentado) {
            reset405Tentado = true;
            apagarSessao();
            console.log("🔄 Tentando gerar QR novo em 5 segundos...");
            setTimeout(iniciarBot, 5000);
            return;
          }

          console.log("⛔ 405 persistente. Troque AUTH_DIR no Railway.");
          return;
        }

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          qrAtual = null;
          apagarSessao();
          console.log("⚠️ Sessão deslogada. Gerando novo QR em 5 segundos...");
          setTimeout(iniciarBot, 5000);
          return;
        }

        console.log("🔄 Reconectando em 8 segundos...");
        setTimeout(iniciarBot, 8000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const msg of messages || []) {
        if (!msg?.message) continue;

        const tipo = obterTipoMensagem(msg);


        if (tipo === "protocolMessage") {
  console.log("⏭️ protocolMessage ignorada");
  continue;
}
        const texto = obterTextoMensagem(msg);
        const fromMe = !!msg.key?.fromMe;
        const remoteJid = msg.key?.remoteJid || "";
        const senderJid = msg.key?.participant || msg.key?.remoteJid || "";
        const messageId = msg.key?.id || null;
        const timestampWhatsapp = obterTimestampWhatsapp(msg);

        console.log("📩 Mensagem recebida:", {
          tipo,
          fromMe,
          remoteJid,
          senderJid,
          texto: texto ? texto.substring(0, 80) : ""
        });

        let r2Bucket = null;
        let r2Key = null;
        let r2UrlInterna = null;
        let mimeType = null;
        let fileName = null;
        let fileSize = null;

        const ehMidia =
          tipo === "imageMessage" ||
          tipo === "audioMessage" ||
          tipo === "videoMessage" ||
          tipo === "documentMessage" ||
          tipo === "stickerMessage";

        if (ehMidia) {
          try {
            const buffer = await downloadMediaMessage(
              msg,
              "buffer",
              {},
              { logger: P({ level: "silent" }) }
            );

            const nomeArquivo = montarNomeArquivo(msg, tipo);
            mimeType = obterContentType(msg, tipo);
            fileName = obterNomeOriginalArquivo(msg, tipo, nomeArquivo);
            fileSize = buffer.length;

            const resultado = await uploadArquivo(buffer, nomeArquivo, mimeType);

            r2Bucket = resultado.bucket;
            r2Key = resultado.key;
            r2UrlInterna = resultado.urlInterna;

            console.log("📦 Upload R2 concluído:", resultado);
          } catch (err) {
            console.log("❌ Erro ao salvar no Neon:", {
  message: err.message,
  code: err.code,
  detail: err.detail,
  table: err.table,
  constraint: err.constraint
});
          }
        }

        try {
          await salvarConversa(remoteJid);

          await salvarMensagem({
            messageId,
            remoteJid,
            senderJid,
            fromMe,
            tipo,
            texto,
            timestampWhatsapp,
            r2Bucket,
            r2Key,
            r2UrlInterna,
            mimeType,
            fileName,
            fileSize,
            rawJson: msg
          });

          console.log("💾 Mensagem salva no Neon:", messageId);
} catch (err) {
  console.log("❌ Erro ao salvar no Neon:", {
    message: err.message,
    code: err.code,
    detail: err.detail,
    table: err.table,
    constraint: err.constraint
  });
}
  } catch (err) {
    iniciando = false;
    console.log("💥 Erro ao iniciar bot:", err.message);
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
    authDir: AUTH_DIR,
    r2: {
      bucket: process.env.R2_BUCKET || null,
      endpointConfigurado: !!process.env.R2_ENDPOINT,
      accessKeyConfigurada: !!process.env.R2_ACCESS_KEY_ID,
      secretConfigurada: !!process.env.R2_SECRET_ACCESS_KEY
    },
    neon: {
      databaseConfigurada: !!process.env.DATABASE_URL
    }
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

app.get("/reset-session", async (req, res) => {
  try {
    if (sock) {
      try {
        await sock.logout();
      } catch {}
    }

    conectado = false;
    qrAtual = null;
    iniciando = false;
    reset405Tentado = false;

    apagarSessao();

    setTimeout(iniciarBot, 2000);

    res.send("<h1>Sessão apagada. Aguarde alguns segundos e abra /qr</h1>");
  } catch (err) {
    res.status(500).send("Erro ao resetar sessão: " + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  conferirEnv();
  iniciarBot();
});
