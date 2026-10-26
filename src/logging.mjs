// 带轮转的追加写日志：默认落 ~/.zcode/cli/log（不可写时由调用方兜底），单文件超限轮转为 .old
import fs from "node:fs";

export function rotatingAppend(file, line, maxBytes = 5 * 1024 * 1024) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
      fs.renameSync(file, `${file}.old`);
    }
  } catch {}
  try {
    fs.appendFileSync(file, line + "\n");
  } catch {}
}
