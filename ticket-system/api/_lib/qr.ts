import QRCode from 'qrcode';

// Render a signed token into a PNG buffer (for email attachments) or a data
// URL (for inline rendering). Error correction level 'M' balances density and
// resilience to phone-camera scanning at the door.
export async function tokenToPngBuffer(token: string): Promise<Buffer> {
  return QRCode.toBuffer(token, {
    errorCorrectionLevel: 'M',
    type: 'png',
    margin: 2,
    width: 512
  });
}

export async function tokenToDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512
  });
}
