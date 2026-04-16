/**
 * 光栅卡引擎
 *
 * 核心原理：
 * 传感器角度 → 低通滤波(去抖) → 连续位置计算 → { displayIndex, nextIndex, fraction }
 *
 * 每张图的角度范围分为三段：
 *   [过渡区] ← [稳定区(dead zone)] → [过渡区]
 * 稳定区内 fraction=0，显示纯净当前图；
 * 过渡区内 fraction 从 0→1，触发光栅条纹交错效果。
 */

/** 稳定区占每张图角度范围的比例 */
var DEAD_ZONE_RATIO = 0.55;

/**
 * 一阶 IIR 低通滤波
 */
function applyLowPassFilter(rawAngle, prevAngle, alpha) {
  if (alpha === undefined) alpha = 0.15;
  return prevAngle + alpha * (rawAngle - prevAngle);
}

/**
 * 创建带状态的连续光栅引擎
 */
function createEngine() {
  var anchorAngle = 0;
  var lastDisplayIndex = -1;
  var initialized = false;

  /**
   * 根据当前角度计算连续位置 + 过渡比例
   * @param {number} angle          - 滤波后的角度
   * @param {number} imageCount     - 图片总数
   * @param {number} degreesPerImage - 每张图片对应的角度跨度
   * @returns {{ displayIndex: number, nextIndex: number, fraction: number, changed: boolean }}
   */
  function update(angle, imageCount, degreesPerImage) {
    if (imageCount <= 0) {
      return { displayIndex: 0, nextIndex: 0, fraction: 0, changed: false };
    }

    if (!initialized) {
      anchorAngle = angle;
      lastDisplayIndex = 0;
      initialized = true;
      return { displayIndex: 0, nextIndex: 1 % imageCount, fraction: 0, changed: false };
    }

    // 连续位置（可为负）
    var rawPos = (angle - anchorAngle) / degreesPerImage;

    // 映射到 [0, imageCount) 循环
    var pos = ((rawPos % imageCount) + imageCount) % imageCount;

    // 在当前图内的偏移 [0, 1)
    var intraPos = pos - Math.floor(pos);

    // 计算稳定区和过渡区
    var halfDead = DEAD_ZONE_RATIO / 2;        // 稳定区半宽（0.275）
    var transitionWidth = (1 - DEAD_ZONE_RATIO) / 2; // 过渡区宽度（0.225）

    var displayIndex = Math.floor(pos) % imageCount;
    var fraction = 0;
    var nextIndex;

    if (intraPos < transitionWidth) {
      // 前过渡区：从上一张过渡到当前图（fraction 从 1→0 方向看，
      // 但对于"上一张→当前"来说是过渡尾端）
      // 这里理解为：当前图和前一张图之间的过渡
      var prevIndex = ((displayIndex - 1) % imageCount + imageCount) % imageCount;
      // 过渡进度：0（刚进入）→ 1（过渡完成进入稳定区）
      var progress = intraPos / transitionWidth;
      // 反转：显示前一张图，fraction 表示"前一张→当前"的过渡
      displayIndex = prevIndex;
      nextIndex = (prevIndex + 1) % imageCount;
      fraction = 0.5 + progress * 0.5; // 从 0.5 过渡到 1（接续上一段的后半程）
    } else if (intraPos > 1 - transitionWidth) {
      // 后过渡区：当前图向下一张过渡
      nextIndex = (displayIndex + 1) % imageCount;
      var progress2 = (intraPos - (1 - transitionWidth)) / transitionWidth;
      fraction = progress2 * 0.5; // 从 0 过渡到 0.5（前半程）
    } else {
      // 稳定区：纯当前图
      nextIndex = (displayIndex + 1) % imageCount;
      fraction = 0;
    }

    var changed = displayIndex !== lastDisplayIndex;
    lastDisplayIndex = displayIndex;

    return {
      displayIndex: displayIndex,
      nextIndex: nextIndex,
      fraction: fraction,
      changed: changed,
    };
  }

  function reset() {
    anchorAngle = 0;
    lastDisplayIndex = -1;
    initialized = false;
  }

  function getState() {
    return { anchorAngle, initialized };
  }

  return { update, reset, getState };
}

module.exports = {
  applyLowPassFilter,
  createEngine,
};
