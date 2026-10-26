// Cherry BiM — поток кадров просмотрщика для экрана без браузера (телевизор). Кадр сцены и подписи режиссёра
// склеиваются в один холст, кодировщик WebCodecs (H.264, видеокарта) сжимает его, куски уходят по WebSocket тому, кто
// собирает из них видео (на ПК — HLS для телевизора).
// Часы — номер кадра от старта: кадров ровно fps в секунду реального времени; не успел — номер догоняет время
// (кадр пропускается, видео не замедляется). Метка кадра в мкс идёт от начала потока.
// Сообщение куска: 16 байт заголовка — тип (1 опорный, 0 обычный), 3 байта нулей, метка f64 (мкс), длительность u32
// (мкс), — затем байты H.264 Annex B. Первым идёт текст {type: "hello", width, height, fps, codec}.
const CODEC = "avc1.640028";                              // High 4.0: 1080p60 тянет любой телевизор

export async function startCapture({ url, fps = 60, bitrate = 14e6, gop = 30, canvas, director, frame, onStop = () => {} }) {
  if (typeof VideoEncoder !== "function") throw new Error("нет WebCodecs");
  const W = canvas.width & ~1, H = canvas.height & ~1;
  const cfg = { codec: CODEC, width: W, height: H, bitrate, bitrateMode: "variable", framerate: fps,
                hardwareAcceleration: "prefer-hardware", latencyMode: "realtime", avc: { format: "annexb" } };
  if (!(await VideoEncoder.isConfigSupported(cfg)).supported) throw new Error("кодировщик не берёт " + JSON.stringify(cfg));

  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error("нет связи с " + url)); });

  const comp = document.createElement("canvas");
  comp.width = W; comp.height = H;
  const g = comp.getContext("2d", { alpha: false });
  const bg = backdrop(W, H);
  const st = { frames: 0, dropped: 0, keys: 0, bytes: 0, renderMs: 0, started: performance.now(), error: null };
  let stopped = false, wantKey = true;

  const enc = new VideoEncoder({
    output: chunk => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const buf = new ArrayBuffer(16 + chunk.byteLength), dv = new DataView(buf);
      dv.setUint8(0, chunk.type === "key" ? 1 : 0);
      dv.setFloat64(4, chunk.timestamp, true);
      dv.setUint32(12, chunk.duration || 0, true);
      chunk.copyTo(new Uint8Array(buf, 16));
      ws.send(buf);
      st.bytes += chunk.byteLength;
      if (chunk.type === "key") st.keys++;
    },
    error: e => { st.error = String(e); stop(); },
  });
  enc.configure(cfg);
  ws.send(JSON.stringify({ type: "hello", width: W, height: H, fps, codec: CODEC, gop }));
  ws.onmessage = ev => { if (ev.data === "key") wantKey = true; };
  ws.onclose = () => stop();

  const t0 = performance.now();
  let n = 0;
  const step = () => {
    if (stopped) return;
    const now = performance.now(), due = t0 + n * 1000 / fps;
    if (now < due - 0.5) { setTimeout(step, Math.max(0, due - now - 0.5)); return; }
    if (now - due > 250) {                                  // отстали (Chrome занят) — догнать время, а не замедлиться
      const k = Math.floor((now - t0) * fps / 1000);
      st.dropped += k - n;
      n = k;
    }
    if (enc.encodeQueueSize > 3 || ws.bufferedAmount > 8e6) { st.dropped++; n++; setTimeout(step, 1); return; }
    const t = t0 + n * 1000 / fps, r0 = performance.now();
    frame(t, true);
    g.drawImage(bg, 0, 0);
    g.drawImage(canvas, 0, 0, W, H);
    director.overlay.draw(g, W, H);
    const vf = new VideoFrame(comp, { timestamp: Math.round(n * 1e6 / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: wantKey || n % gop === 0 });
    vf.close();
    wantKey = false;
    st.renderMs = st.renderMs * 0.95 + (performance.now() - r0) * 0.05;
    st.frames++;
    n++;
    setTimeout(step, 0);
  };
  step();

  function stop() {
    if (stopped) return;
    stopped = true;
    enc.flush().catch(() => {}).finally(() => {
      try { enc.close(); } catch { /* уже закрыт */ }
      try { ws.close(); } catch { /* уже закрыт */ }
      onStop(st);
    });
  }
  return { stop, stats: () => ({ ...st, seconds: Math.round((performance.now() - st.started) / 100) / 10 }) };
}

// один кадр в момент t (мс) — как его увидит телевизор: фон, сцена, подписи. Для проверки и обложки потока
export function snapshot({ canvas, director, frame, t, type = "image/jpeg", quality = 0.92 }) {
  frame(t, true);
  const W = canvas.width & ~1, H = canvas.height & ~1, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { alpha: false });
  g.drawImage(backdrop(W, H), 0, 0);
  g.drawImage(canvas, 0, 0, W, H);
  director.overlay.draw(g, W, H);
  return c.toDataURL(type, quality);
}

// фон за сценой — как в режиме ТВ на экране (style.css, body.tv #c): холст сцены прозрачен там, где ничего нет
function backdrop(W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(W * 0.5, H * 0.44, 0, W * 0.5, H * 0.44, Math.hypot(W, H) * 0.62);
  r.addColorStop(0, "#2b3242");
  r.addColorStop(0.52, "#171b24");
  r.addColorStop(1, "#0b0d12");
  g.fillStyle = r;
  g.fillRect(0, 0, W, H);
  return c;
}
