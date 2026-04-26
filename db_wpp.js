import { pool } from './db.js';

function extrairTelefone(jid) {
  if (!jid) return null;
  if (jid.includes('@s.whatsapp.net')) return jid.split('@')[0];
  return null;
}

export async function salvarConversa(remoteJid, nome = null) {
  const telefone = extrairTelefone(remoteJid);
  const tipo = remoteJid.includes('@g.us') ? 'grupo' : 'individual';

  await pool.query(`
    INSERT INTO wwp_personas.wpp_conversas
    (remote_jid, telefone_limpo, nome, tipo)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (remote_jid)
    DO UPDATE SET updated_at = NOW()
  `, [remoteJid, telefone, nome, tipo]);
}

export async function salvarMensagem(dados) {
  const {
    messageId,
    remoteJid,
    senderJid,
    fromMe,
    tipo,
    texto,
    timestamp,
    r2
  } = dados;

  const telefone = extrairTelefone(remoteJid);

  await pool.query(`
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
      raw_json
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
    )
    ON CONFLICT (message_id) DO NOTHING
  `, [
    messageId,
    remoteJid,
    telefone,
    senderJid,
    fromMe,
    tipo,
    texto,
    timestamp,
    r2?.bucket || null,
    r2?.key || null,
    r2?.url || null,
    r2?.mime || null,
    r2?.fileName || null,
    r2?.size || null,
    JSON.stringify(dados)
  ]);
}
