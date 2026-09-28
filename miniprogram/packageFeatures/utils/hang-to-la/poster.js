function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasImage(canvas, path) {
  return new Promise((resolve) => {
    if (!path) return resolve(null);
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = path;
  });
}

function imageInfoPath(src, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('image load timeout')), timeoutMs);
    wx.getImageInfo({
      src,
      success: (result) => finish(resolve, result.path),
      fail: (error) => finish(reject, error),
    });
  });
}

async function loadCanvasImage(canvas, src) {
  if (!src) return null;
  try {
    return canvasImage(canvas, await imageInfoPath(src));
  } catch (error) {
    return null;
  }
}

async function loadCanvasImages(canvas, items, concurrency) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  const imageMap = {};
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < list.length) {
      const item = list[nextIndex];
      nextIndex += 1;
      const image = await loadCanvasImage(canvas, item.cover);
      if (image) imageMap[item.id] = image;
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return imageMap;
}

function drawImageAspectFill(ctx, image, x, y, width, height, radius) {
  if (!image) return false;
  const imageWidth = image.width || width;
  const imageHeight = image.height || height;
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, (imageWidth - sourceWidth) / 2);
  const sourceY = Math.max(0, (imageHeight - sourceHeight) / 2);
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  ctx.restore();
  return true;
}

function drawImageContain(ctx, image, x, y, width, height) {
  if (!image) return false;
  const imageWidth = image.width || width;
  const imageHeight = image.height || height;
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

function fittedTitle(ctx, text, maxWidth, maxSize, minSize) {
  let value = String(text || '').trim();
  let size = maxSize;
  ctx.font = `bold ${size}px sans-serif`;
  while (size > minSize && ctx.measureText(value).width > maxWidth) {
    size -= 2;
    ctx.font = `bold ${size}px sans-serif`;
  }
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 2 && ctx.measureText(value + '…').width > maxWidth) value = value.slice(0, -1);
  return value + '…';
}

function drawPoster(ctx, height, imageMap, rowHeights, tiers, wordmark, rankedCount, title, config) {
  const C = config;
  const width = C.canvasWidth;
  ctx.fillStyle = '#fffdf9';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#11295c';
  ctx.fillText(fittedTitle(ctx, title || C.title, 460, C.maxTitleSize, C.minTitleSize), 44, 58);
  const previousTextAlign = ctx.textAlign;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#477bd9';
  ctx.font = 'bold 23px sans-serif';
  const rankedCountLabel = String(rankedCount) + ' 部';
  ctx.fillText(rankedCountLabel, C.contentRightX, 59);
  const rankedCountWidth = ctx.measureText(rankedCountLabel).width;
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#7b87a0';
  ctx.fillText('已入榜', C.contentRightX - rankedCountWidth - 10, 59);
  ctx.fillStyle = '#dce7fb';
  ctx.fillRect(574, 76, C.contentRightX - 574, 3);
  ctx.fillStyle = '#9ab5ed';
  ctx.beginPath();
  ctx.arc(564, 77.5, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = previousTextAlign || 'left';
  ctx.fillStyle = '#66708a';
  ctx.font = '24px sans-serif';
  ctx.fillText(C.subtitle, 44, 91);
  ctx.fillStyle = '#8b93a5';
  ctx.font = '18px sans-serif';
  ctx.fillText(C.rankingNote, 44, 119);
  ctx.fillStyle = '#f27670';
  ctx.fillRect(44, 136, 104, 6);
  ctx.fillStyle = '#f2b638';
  ctx.fillRect(162, 136, 56, 6);
  let y = C.topHeight;
  tiers.forEach((tier, index) => {
    const tierHeight = rowHeights[index];
    ctx.fillStyle = tier.tint;
    roundedRect(ctx, C.rowX, y, C.rowWidth, tierHeight, 20);
    ctx.fill();
    ctx.fillStyle = tier.color;
    roundedRect(ctx, C.rowX, y, C.rowLabelWidth, tierHeight, 20);
    ctx.fill();
    ctx.fillStyle = '#fff';
    const labelCenter = y + tierHeight / 2;
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(tier.label, C.rowX + 10, labelCenter - 8);
    ctx.font = '22px sans-serif';
    ctx.fillText(tier.items.length + ' 部', C.rowX + 11, labelCenter + 28);
    tier.items.forEach((item, itemIndex) => {
      const column = itemIndex % C.rowColumns;
      const line = Math.floor(itemIndex / C.rowColumns);
      const x = C.coverStartX + column * (C.rowCoverWidth + C.rowCoverGap);
      const cardY = y + C.rowContentPadding + line * (C.rowCoverHeight + C.rowCoverGapY);
      const image = imageMap[item.id];
      ctx.fillStyle = '#fff';
      roundedRect(ctx, x, cardY, C.rowCoverWidth, C.rowCoverHeight, 12);
      ctx.fill();
      if (image) {
        drawImageAspectFill(ctx, image, x + 4, cardY + 4, C.rowCoverWidth - 8, C.rowCoverHeight - 8, 9);
      } else {
        ctx.fillStyle = item.coverFallback && item.coverFallback.color ? item.coverFallback.color : '#477bd9';
        roundedRect(ctx, x + 4, cardY + 4, C.rowCoverWidth - 8, C.rowCoverHeight - 8, 9);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText((item.coverFallback && item.coverFallback.char) || '番', x + C.rowCoverWidth / 2, cardY + 60);
        ctx.textAlign = 'left';
      }
    });
    y += tierHeight + C.rowGap;
  });
  const footerY = y + C.footerGap - C.rowGap;
  ctx.strokeStyle = '#e7e3ed';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(44, footerY - 8);
  ctx.lineTo(C.contentRightX, footerY - 8);
  ctx.stroke();
  drawImageContain(ctx, wordmark, 592, footerY + 4, 102, 34);
  ctx.fillStyle = '#11295c';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(C.footerCopy, 44, footerY + 30);
  ctx.fillStyle = '#a2a9b8';
  ctx.font = '17px sans-serif';
  ctx.fillText(C.footerTitle, 44, footerY + 60);
}

module.exports = { imageInfoPath, loadCanvasImage, loadCanvasImages, drawPoster };
