// Writes an RSA private key in PKCS#8 PEM for crx3. Existing keys are kept:
// the key fixes the extension ID, so it must never be regenerated casually.
const { generateKeyPairSync } = require('crypto');
const fs = require('fs');

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/make-key.js <path-to-key.pem>');
  process.exit(1);
}
if (fs.existsSync(target)) {
  process.exit(0);
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

fs.writeFileSync(target, privateKey);
console.log('Created ' + target);
console.log('Back this file up outside the repository. It determines the extension ID.');
