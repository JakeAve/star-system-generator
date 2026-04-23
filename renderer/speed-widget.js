const STYLES = `
#speed-widget {
  position: fixed; top: 16px; right: 16px; z-index: 15;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: rgba(0,0,0,0.75);
  border: 1px solid #2a2a3a; border-radius: 4px;
  color: #ccc; font-family: monospace; font-size: 11px;
  user-select: none;
}
#speed-widget label { color: #888; }
#speed-widget input[type=range] { width: 140px; accent-color: #6ab0d4; }
#speed-widget .speed-val { color: #aaa; min-width: 42px; text-align: right; }
`;

let widgetEl = null;
let styleEl = null;

export function buildSpeedWidget(onTimeScale) {
  clearSpeedWidget();

  styleEl = document.createElement("style");
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  widgetEl = document.createElement("div");
  widgetEl.id = "speed-widget";

  const label = document.createElement("label");
  label.textContent = "Speed";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = "1";

  const val = document.createElement("span");
  val.className = "speed-val";

  function apply(v) {
    const ts = 0.1 * Math.pow(5000, v / 100);
    val.textContent = ts < 10 ? `${ts.toFixed(1)}×` : `${Math.round(ts)}×`;
    onTimeScale(ts);
  }
  apply(Number(slider.value));
  slider.addEventListener("input", () => apply(Number(slider.value)));

  widgetEl.append(label, slider, val);
  document.body.appendChild(widgetEl);
}

export function clearSpeedWidget() {
  widgetEl?.remove();
  styleEl?.remove();
  widgetEl = null;
  styleEl = null;
}
