// Exam-period status line, shared by the main process (tray tooltip) and
// the wallpaper/settings pages.
(function (root) {
  function examStatus(cfg, now) {
    now = now || new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = (d) => (d ? Math.round((new Date(d + "T00:00:00") - t0) / 86400000) : null);
    const toStart = days(cfg.examDate);
    const toEnd = days(cfg.examEndDate || cfg.examDate);
    if (toStart === null && toEnd === null) return null;
    if (toStart !== null && toStart > 0) return { phase: "before", big: `D-${toStart}`, label: "시험까지" };
    if (toEnd !== null && toEnd >= 0) {
      return toEnd === 0
        ? { phase: "during", big: "마지막 날", label: "오늘만 버티면 끝" }
        : { phase: "during", big: `D-${toEnd}`, label: "시험 기간 · 끝까지" };
    }
    return { phase: "after", big: "끝!", label: "시험 수고했어" };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = examStatus;
  else root.examStatus = examStatus;
})(this);
