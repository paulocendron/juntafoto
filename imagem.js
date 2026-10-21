/* ============================================================
   JuntaFoto · conversão para JPEG e compressão (usado pelo app e pelo painel admin)
   ============================================================ */
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB — fotos maiores são comprimidas antes do envio

/* Tentativas de compressão, da melhor qualidade para a menor, até caber em MAX_FILE_SIZE */
const JPEG_ATTEMPTS = [
  { maxDim: 2400, quality: 0.88 },
  { maxDim: 2400, quality: 0.75 },
  { maxDim: 1920, quality: 0.70 },
  { maxDim: 1600, quality: 0.65 },
  { maxDim: 1280, quality: 0.60 },
];

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function renderJpeg(img, maxDim, quality) {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
    else                { width  = Math.round(width  * maxDim / height); height = maxDim; }
  }
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha ao converter.')), 'image/jpeg', quality);
  });
}

async function convertToJpeg(file) {
  const img  = await loadImage(file);
  const name = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
  for (const { maxDim, quality } of JPEG_ATTEMPTS) {
    const blob = await renderJpeg(img, maxDim, quality);
    if (blob.size <= MAX_FILE_SIZE) return new File([blob], name, { type: 'image/jpeg' });
  }
  throw new Error('Não foi possível reduzir a foto para até 8 MB.');
}

/* Converte; se a conversão falhar, usa o original só quando já está dentro do limite */
async function prepareForUpload(file) {
  try {
    return await convertToJpeg(file);
  } catch (_) {
    if (file.size <= MAX_FILE_SIZE) return file;
    throw new Error('Não foi possível reduzir a foto para até 8 MB. Tente outra foto.');
  }
}
