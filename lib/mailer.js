

const COPY = {
  register: {
    subject: 'Your eywa.lol verification code',
    heading: 'Verify your email',
    bodyLine: 'Use this code to finish creating your eywa.lol account. It expires in 10 minutes.',
  },
  reset: {
    subject: 'Your eywa.lol password reset code',
    heading: 'Reset your password',
    bodyLine: 'Use this code to reset your eywa.lol password. It expires in 10 minutes.',
  },
  login2fa: {
    subject: 'Your eywa.lol login code',
    heading: 'Confirm it\u2019s you',
    bodyLine: 'Use this code to finish logging in to eywa.lol. It expires in 10 minutes. If you didn\u2019t just try to log in, change your password.',
  },
  enable2fa: {
    subject: 'Confirm enabling two-factor authentication',
    heading: 'Enable two-factor authentication',
    bodyLine: 'Use this code to turn on two-factor authentication for your eywa.lol account. It expires in 10 minutes.',
  },
  email_change_current: {
    subject: 'Confirm your eywa.lol email change',
    heading: 'Confirm email change',
    bodyLine: 'Someone requested to change the email on your eywa.lol account. Enter this code, along with the code sent to the new address, to confirm it was you. If you didn\u2019t request this, change your password immediately.',
  },
  email_change_new: {
    subject: 'Confirm your new eywa.lol email',
    heading: 'Confirm your new email',
    bodyLine: 'Use this code, along with the code sent to your current email, to confirm this address as your new eywa.lol login email. It expires in 10 minutes.',
  },
  change_password: {
    subject: 'Confirm your eywa.lol password change',
    heading: 'Confirm password change',
    bodyLine: 'Use this code to confirm your new eywa.lol password. It expires in 10 minutes. If you didn\u2019t request this, ignore this email and your password will stay the same.',
  },
};

const RESEND_API_URL = 'https://api.resend.com/emails';

function configured() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

async function sendCodeEmail(to, code, purpose) {
  const from = process.env.MAIL_FROM || 'eywa.lol <noreply@eywa.lol>';

  const copy = COPY[purpose] || COPY.register;
  const { subject, heading, bodyLine } = copy;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#080808;color:#e6e6e6;padding:32px;">
    <div style="max-width:420px;margin:0 auto;background:#111;border:1px solid #262626;border-radius:14px;padding:32px;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#fff;">${heading}</h2>
      <p style="margin:0 0 20px;font-size:13.5px;color:#a3a3a3;line-height:1.5;">${bodyLine}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;
                  background:#080808;border:1px solid #262626;border-radius:10px;
                  padding:18px 0;color:#35fe7e;">${code}</div>
      <p style="margin:20px 0 0;font-size:12px;color:#666;line-height:1.5;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  </div>`;

  if (!configured()) {
    
    console.warn(`[mailer] Resend not configured — would have sent "${subject}" to ${to} with code ${code}`);
    return { sent: false };
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text: `${heading}\n\n${bodyLine}\n\nYour code: ${code}`,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${errBody}`);
  }

  return { sent: true };
}

function generateCode() {
  // 6-digit numeric code, zero-padded
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

module.exports = { sendCodeEmail, generateCode, configured };
