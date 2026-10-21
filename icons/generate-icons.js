/**
 * Gerador de ícones PNG para o JuntaFoto PWA
 * Executa com: node generate-icons.js
 * Requer: npm install sharp
 */
const sharp = require('sharp');
const path = require('path');

const svgPath = path.join(__dirname, 'icon.svg');

async function generate() {
  for (const size of [192, 512]) {
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(path.join(__dirname, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png gerado`);
  }
}

generate().catch(console.error);
