/**
 * Envio do email de recuperação de senha.
 *
 * Se houver SMTP configurado (variável SMTP_URL), manda de verdade. Sem
 * configuração nenhuma o jogo continua funcionando: o link é impresso no
 * console do servidor e devolvido para a tela, para você não ficar travado.
 */

import nodemailer from 'nodemailer';

const SMTP_URL = process.env.SMTP_URL || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Mesa do Mentiroso <nao-responda@mesadomentiroso.local>';

let transport = null;
if (SMTP_URL) {
  try {
    transport = nodemailer.createTransport(SMTP_URL);
    console.log('[mailer] SMTP configurado — emails de recuperação serão enviados de verdade.');
  } catch (err) {
    console.error('[mailer] SMTP_URL inválida, caindo no modo console:', err.message);
  }
} else {
  console.log('[mailer] Sem SMTP_URL: os links de recuperação aparecem aqui no console.');
}

export const mailerIsLive = () => !!transport;

function template({ username, link }) {
  const text = [
    `Olá, ${username}!`,
    '',
    `Seu nome de usuário na Mesa do Mentiroso é: ${username}`,
    '',
    'Para escolher uma nova senha, abra o link abaixo (vale por 1 hora):',
    link,
    '',
    'Se não foi você quem pediu, pode ignorar este email — sua senha continua a mesma.',
  ].join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#120c08;color:#f2e8d8;padding:32px">
      <h1 style="color:#e9b44c;margin:0 0 8px">Mesa do Mentiroso</h1>
      <p style="color:#a2917a;margin:0 0 24px">Recuperação de acesso</p>
      <p>Olá! Seu nome de usuário é:</p>
      <p style="font-size:22px;font-weight:bold;color:#e9b44c;margin:8px 0 24px">${escapeHtml(username)}</p>
      <p>Clique no botão abaixo para escolher uma nova senha. O link vale por 1 hora.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(link)}"
           style="background:#e9b44c;color:#24170a;padding:14px 26px;border-radius:10px;
                  text-decoration:none;font-weight:bold">Redefinir minha senha</a>
      </p>
      <p style="color:#a2917a;font-size:13px">
        Se não foi você quem pediu, ignore este email — sua senha continua a mesma.
      </p>
    </div>`;

  return { text, html };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * @returns {Promise<{sent: boolean, link: string}>} `sent:false` significa que
 *          o link não foi por email e precisa ser mostrado na tela.
 */
export async function sendResetEmail({ to, username, link }) {
  const { text, html } = template({ username, link });

  if (!transport) {
    console.log('\n──────── recuperação de senha ────────');
    console.log(`  usuário: ${username}`);
    console.log(`  email:   ${to}`);
    console.log(`  link:    ${link}`);
    console.log('──────────────────────────────────────\n');
    return { sent: false, link };
  }

  try {
    await transport.sendMail({
      from: MAIL_FROM,
      to,
      subject: 'Mesa do Mentiroso — recuperar acesso',
      text,
      html,
    });
    return { sent: true, link };
  } catch (err) {
    console.error('[mailer] falha ao enviar, mostrando o link na tela:', err.message);
    console.log(`  link de recuperação: ${link}`);
    return { sent: false, link };
  }
}
