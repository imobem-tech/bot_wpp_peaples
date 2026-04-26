import { pool } from "./db.js";

export function extrairTelefoneLimpo(jid) {
  if (!jid) return null;
  if (jid.includes("@s.whatsapp.net")) return jid.split("@")[0];
  return null;
}

export function tipoConversa(remoteJid) {
  if (!remoteJid) return null;
  if (remoteJid.includes("@g.us")) return "grupo";
  return "individual";
}

export async function salvarConversa(remoteJid, nome = null) {
  const telefoneLimpo = extrairTelefoneLimpo(remoteJid);
  const tipo = tipoConversa(remoteJid);

  await pool.query(
    `
    INSERT INTO wwp_personas.wpp_conversas (
      remote_jid,
      telefone_limpo,
      nome,
      tipo,
      ativo,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      TRUE,
      NOW() AT TIME ZONE 'America/Sao_Paulo',
      NOW() AT TIME ZONE 'America/Sao_Paulo'
    )
    ON CONFLICT (remote_jid)
    DO UPDATE SET
      telefone_limpo = EXCLUDED.telefone_limpo,
      nome = COALESCE(EXCLUDED.nome, wwp_personas.wpp_conversas.nome),
      tipo = EXCLUDED.tipo,
      ativo = TRUE,
      updated_at = NOW() AT TIME ZONE 'America/Sao_Paulo'
    `,
    [remoteJid, telefoneLimpo, nome, tipo]
  );
}

export async function salvarMensagem(dados) {
  const telefoneLimpo = extrairTelefoneLimpo(dados.remoteJid);

  await pool.query(
    `
    INSERT INTO wwp_personas.wpp_mensagens (
      message_id,
      remote_jid,
      telefone_limpo,
      sender_jid,
      from_me,
      tipo,
      texto,
      timestamp_whatsapp,
      r2_bucket,
      r2_key,
      r2_url_interna,
      mime_type,
      file_name,
      file_size,
      created_at,
      raw_json
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,
      $9,$10,$11,$12,$13,$14,
      NOW() AT TIME ZONE 'America/Sao_Paulo',
      $15::jsonb
    )
    ON CONFLICT (message_id) DO NOTHING
    `,
    [
      dados.messageId,
      dados.remoteJid,
      telefoneLimpo,
      dados.senderJid,
      dados.fromMe,
      dados.tipo,
      dados.texto,
      dados.timestampWhatsapp,
      dados.r2Bucket,
      dados.r2Key,
      dados.r2UrlInterna,
      dados.mimeType,
      dados.fileName,
      dados.fileSize,
      JSON.stringify(dados.rawJson || {})
    ]
  );
}
