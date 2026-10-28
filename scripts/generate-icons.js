const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const assets = path.join(__dirname, '../assets');
const squircle = 'M512 64C858 64 960 64 960 410V614C960 960 858 960 512 960S64 960 64 614V410C64 64 166 64 512 64Z';
const concepts = [
  { name: '01-leap', title: '01  Leap', colors: ['#ff966f', '#f15c46'], shape: '<path d="M304 669V355M304 559C304 398 614 398 614 559V669" fill="none" stroke="white" stroke-width="116" stroke-linecap="round"/><circle cx="716" cy="335" r="69" fill="white"/>' },
  { name: '02-orbit', title: '02  Orbit', colors: ['#66ba9e', '#196d66'], shape: '<g fill="none" stroke="white" stroke-width="94" stroke-linecap="round"><path d="M393 672C224 650 218 405 365 348C463 310 558 363 583 429"/><path d="M631 352C800 374 806 619 659 676C561 714 466 661 441 595"/></g>' },
  { name: '03-fold', title: '03  Fold', colors: ['#a5a7ee', '#5455b4'], shape: '<path d="M252 568L749 267L597 758L472 578L252 568Z" fill="white"/><path d="M472 578L749 267" stroke="#7779cf" stroke-width="29" stroke-linecap="round"/>' }
];
function svg(concept) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="0.7" y2="1"><stop stop-color="${concept.colors[0]}"/><stop offset="1" stop-color="${concept.colors[1]}"/></linearGradient></defs><path d="${squircle}" fill="url(#g)"/><path d="${squircle}" fill="none" stroke="white" stroke-opacity=".22" stroke-width="3"/>${concept.shape}</svg>`;
}
async function main() {
  await fs.mkdir(path.join(assets, 'concepts'), { recursive: true });
  const pngs = [];
  for (const concept of concepts) {
    const source = svg(concept);
    await fs.writeFile(path.join(assets, 'concepts', `${concept.name}.svg`), source);
    const png = await sharp(Buffer.from(source)).png().toBuffer();
    pngs.push(png);
    await fs.writeFile(path.join(assets, 'concepts', `${concept.name}.png`), png);
  }
  const selected = pngs[0];
  await fs.writeFile(path.join(assets, 'icon.svg'), svg(concepts[0]));
  await fs.writeFile(path.join(assets, 'icon.png'), selected);
  const sizes = [16, 32, 48, 64, 128, 256];
  const icoImages = await Promise.all(sizes.map(size => sharp(selected).resize(size, size).png().toBuffer()));
  const icoHeader = Buffer.alloc(6 + sizes.length * 16);
  icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(sizes.length, 4);
  let offset = icoHeader.length;
  icoImages.forEach((png, i) => {
    const at = 6 + i * 16;
    icoHeader[at] = sizes[i] === 256 ? 0 : sizes[i]; icoHeader[at + 1] = icoHeader[at];
    icoHeader.writeUInt16LE(1, at + 4); icoHeader.writeUInt16LE(32, at + 6);
    icoHeader.writeUInt32LE(png.length, at + 8); icoHeader.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  await fs.writeFile(path.join(assets, 'icon.ico'), Buffer.concat([icoHeader, ...icoImages]));
  const icnsParts = [];
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const png = await sharp(selected).resize(size, size).png().toBuffer();
    const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(png.length + 8, 4);
    icnsParts.push(header, png);
  }
  const icnsHeader = Buffer.alloc(8); icnsHeader.write('icns'); icnsHeader.writeUInt32BE(8 + icnsParts.reduce((n, part) => n + part.length, 0), 4);
  await fs.writeFile(path.join(assets, 'icon.icns'), Buffer.concat([icnsHeader, ...icnsParts]));
  const layers = [];
  for (let i = 0; i < pngs.length; i++) {
    layers.push({ input: await sharp(pngs[i]).resize(256).toBuffer(), left: 64 + i * 352, top: 110 });
    for (const [j, size] of [16, 32, 64].entries()) layers.push({ input: await sharp(pngs[i]).resize(size).toBuffer(), left: 96 + i * 352 + j * 70, top: 438 - size / 2 });
  }
  const labels = `<svg width="1184" height="560"><style>text{font-family:Helvetica,Arial,sans-serif;fill:#2e302d}</style><text x="72" y="56" font-size="24" font-weight="600">Hop / Three ways to make the jump.</text>${concepts.map((c, i) => `<text x="${80 + i * 352}" y="392" font-size="19">${c.title}${i === 0 ? '  ·  Selected' : ''}</text>`).join('')}<text x="80" y="510" font-size="16" fill="#757773">1024 px master · native 16 / 32 / 64 px samples · one production icon</text></svg>`;
  layers.push({ input: Buffer.from(labels), left: 0, top: 0 });
  await sharp({ create: { width: 1184, height: 560, channels: 4, background: '#f5f3ef' } }).composite(layers).png().toFile(path.join(assets, 'concepts', 'comparison.png'));
  console.log('Generated 3 icon concepts, comparison, and selected PNG/SVG/ICNS/ICO.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
