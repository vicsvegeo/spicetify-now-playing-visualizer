// NAME: Now Playing Visualizer
// AUTHOR: vicsvegeo
// VERSION: 1.0.1
// DESCRIPTION: Turns the cover art in Spotify's Now Playing view into an audio visualizer.
// Driven by Spotify's audio analysis (loudness, pitch, beats and sections, synced to playback).
// Shows in three places:
//  - "panel": over the cover in the Now Playing side panel
//  - "tall":  over the Canvas video in the side panel (toggle with the pill button)
//  - "stage": the expanded / full screen Now Playing view (toggle in its mode switcher)
// https://github.com/vicsvegeo/spicetify-now-playing-visualizer

(function npvVisualizer() {
  // Installed both by setup and from the Marketplace? Only run once.
  if (window.__nowPlayingVisualizer && window.__nowPlayingVisualizer !== npvVisualizer) return;
  window.__nowPlayingVisualizer = npvVisualizer;
  const S = window.Spicetify;
  if (!S?.Player?.addEventListener || !S?.getAudioData || !document.body) {
    setTimeout(npvVisualizer, 300);
    return;
  }

  const LEVELS = 64;
  const FALLBACK_COLORS = ["#1ed760", "#b3ffcf"];

  // ---- persisted toggles ----
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("npvVisualizer:" + k);
        return v == null ? d : v;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("npvVisualizer:" + k, v);
      } catch {}
    },
  };
  let panelMode = store.get("panelMode", "visualizer"); // "visualizer" | "canvas"
  let stageOn = store.get("stageOn", "1") === "1";

  // ---- per-track data ----
  const analysisCache = new Map();
  let track = { uri: null, analysis: null, colors: FALLBACK_COLORS, maxDb: -5, cover: null, name: "", artist: "" };

  const hasData = (a) => a?.segments?.length > 0;

  function loadAnalysis(uri, item) {
    if (!analysisCache.has(uri)) {
      analysisCache.set(
        uri,
        S.getAudioData(uri)
          .catch(() => null)
          .then((a) => (hasData(a) ? a : findAlternate(uri, item)))
          .catch((e) => {
            console.warn("[npvVisualizer] no audio analysis for", uri, e);
            return null;
          })
      );
    }
    return analysisCache.get(uri);
  }

  // The same recording is often released several times (album, deluxe, regional...) and
  // Spotify only has analysis for some copies. Find another copy with the same title, artist
  // and length (within 3s, which rules out live versions and remixes) and borrow its analysis.
  async function findAlternate(uri, item) {
    const name = item?.name;
    const artist = item?.artists?.[0]?.name || item?.metadata?.artist_name;
    const durMs = Number(item?.duration?.milliseconds ?? item?.metadata?.duration) || 0;
    if (!name || !artist || !S.GraphQL?.Definitions?.searchModalResults) return null;

    const remembered = store.get("alt:" + uri, null);
    if (remembered) {
      const a = await S.getAudioData(remembered).catch(() => null);
      if (hasData(a)) return a;
    }

    const norm = (s) => s.toLowerCase().replace(/\s+-\s+(\d{4}\s+)?remaster(ed)?.*$/, "").trim();
    const res = await S.GraphQL.Request(S.GraphQL.Definitions.searchModalResults, {
      limit: 20,
      numberOfTopResults: 20,
      offset: 0,
      searchTerm: `${name} ${artist}`,
      includeAuthors: false,
    });
    const candidates = (res?.data?.searchV2?.topResultsV2?.itemsV2 || [])
      .map((x) => x.item?.data)
      .filter(
        (t) =>
          t?.uri?.startsWith("spotify:track:") &&
          t.uri !== uri &&
          norm(t.name || "") === norm(name) &&
          (t.artists?.items || []).some((a) => a.profile?.name?.toLowerCase() === artist.toLowerCase())
      )
      .slice(0, 6);

    for (const t of candidates) {
      const a = await S.getAudioData(t.uri).catch(() => null);
      if (hasData(a) && (!durMs || Math.abs(a.track.duration * 1000 - durMs) < 3000)) {
        store.set("alt:" + uri, t.uri);
        return a;
      }
    }
    return null;
  }

  function onSongChange() {
    const item = S.Player.data?.item;
    const uri = item?.uri;
    if (!uri || uri === track.uri) return;
    const t = {
      uri,
      analysis: null,
      colors: FALLBACK_COLORS,
      maxDb: -5,
      cover: null,
      name: item.name || item.metadata?.title || "",
      artist: (item.artists || []).map((a) => a.name).join(", ") || item.metadata?.artist_name || "",
    };
    track = t;
    for (const inst of instances.values()) inst.bg = null;

    if (uri.startsWith("spotify:track:")) {
      loadAnalysis(uri, item).then((a) => {
        if (track !== t || !a?.segments?.length) return;
        t.maxDb = Math.max(...a.segments.map((s) => s.loudness_max));
        t.analysis = a;
      });
    }

    const img = item.metadata?.image_xlarge_url || item.metadata?.image_large_url || item.metadata?.image_url;
    const src = img?.startsWith("spotify:image:") ? `https://i.scdn.co/image/${img.split(":")[2]}` : img;
    if (src) {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        if (track !== t) return;
        t.cover = im;
        t.colors = extractColors(im);
        for (const inst of instances.values()) inst.bg = null;
      };
      im.src = src;
    }
  }

  // Picks the most vivid color in the cover plus a lighter tint of it
  // (Spicetify.colorExtractor returns null on this Spotify build).
  function extractColors(im) {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const g = c.getContext("2d");
      g.drawImage(im, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      let best = null, bestScore = -1;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gr = d[i + 1], b = d[i + 2];
        const max = Math.max(r, gr, b), min = Math.min(r, gr, b);
        const sat = max ? (max - min) / max : 0;
        const score = sat * 0.7 + (max / 255) * 0.3 - (max < 60 ? 1 : 0);
        if (score > bestScore) (bestScore = score), (best = [r, gr, b]);
      }
      if (!best || bestScore < 0.25) return FALLBACK_COLORS;
      // Boost to full brightness so bars stay visible on the dark background.
      const k = 255 / Math.max(...best);
      const main = best.map((v) => Math.round(v * k));
      const light = main.map((v) => Math.round(v + (255 - v) * 0.6));
      const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
      return [hex(main), hex(light)];
    } catch {
      return FALLBACK_COLORS;
    }
  }

  // ---- analysis lookups ----
  function findIndex(arr, t) {
    let lo = 0, hi = (arr?.length || 0) - 1;
    if (hi < 0 || t < arr[0].start) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  const lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));

  function sample(a, maxDb, t) {
    const i = findIndex(a.segments, t);
    if (i < 0) return null;
    const seg = a.segments[i];
    const next = a.segments[i + 1];
    const local = t - seg.start;
    const db =
      local < seg.loudness_max_time
        ? lerp(seg.loudness_start, seg.loudness_max, local / (seg.loudness_max_time || 1e-3))
        : lerp(seg.loudness_max, next ? next.loudness_start : -60, (local - seg.loudness_max_time) / (seg.duration - seg.loudness_max_time || 1e-3));
    const amp = Math.pow(Math.min(1, Math.max(0, (db - (maxDb - 30)) / 30)), 1.4);

    // Cross-fade pitch vectors into the next segment so bars glide instead of jumping.
    const k = Math.max(0, (local - seg.duration * 0.6) / (seg.duration * 0.4));
    const pitches = seg.pitches.map((p, j) => lerp(p, next ? next.pitches[j] : p, k));

    const b = findIndex(a.beats, t);
    const beat = b >= 0 ? Math.exp(-(t - a.beats[b].start) / 0.11) * Math.max(0.4, a.beats[b].confidence) : 0;
    return { amp, pitches, timbre: seg.timbre, beat, beatIndex: b, beatConf: b >= 0 ? a.beats[b].confidence : 0, sectionIndex: findIndex(a.sections, t) };
  }

  // ---- shared audio state, updated once per frame ----
  const audio = {
    levels: new Float32Array(LEVELS),
    amp: 0,
    beat: 0,
    angle: 0,
    spinDir: 1,
    flash: 0,
    onset: 0, // >0 on the frame a new beat starts (its strength)
    lastBeat: -1,
    lastSection: -1,
    playing: false,
  };

  function updateAudio(now, dt) {
    const playing = !S.Player.data?.isPaused;
    const t = (S.Player.getProgress?.() ?? 0) / 1000;
    const s = playing && track.analysis ? sample(track.analysis, track.maxDb, t) : null;
    audio.playing = playing;

    const targetAmp = s ? s.amp : 0;
    audio.amp += (targetAmp - audio.amp) * (targetAmp > audio.amp ? 0.45 : 0.1);
    audio.beat = Math.max(s ? s.beat : 0, audio.beat * Math.pow(0.02, dt));
    if (playing) audio.angle += dt * 0.25 * audio.spinDir;

    audio.onset = 0;
    if (s && s.beatIndex !== audio.lastBeat) {
      if (s.beatIndex === audio.lastBeat + 1) audio.onset = Math.max(0.35, s.beatConf) * (0.5 + s.amp);
      audio.lastBeat = s.beatIndex;
    }
    if (s && s.sectionIndex !== audio.lastSection) {
      if (audio.lastSection >= 0 && s.sectionIndex === audio.lastSection + 1) {
        audio.flash = 1;
        audio.spinDir *= -1;
      }
      audio.lastSection = s.sectionIndex;
    }
    audio.flash *= Math.pow(0.15, dt);

    const L = audio.levels;
    for (let i = 0; i < LEVELS; i++) {
      let target = 0;
      if (s) {
        const p = (i / (LEVELS - 1)) * 11;
        const lo = Math.floor(p), hi = Math.min(11, lo + 1);
        const pitch = lerp(s.pitches[lo], s.pitches[hi], p - lo);
        const tim = Math.abs(s.timbre[1 + (i % 11)] || 0) / 150;
        const wobble = 0.08 * Math.sin(now / 180 + i * 0.9);
        target = s.amp * (0.25 + 0.6 * pitch + 0.25 * tim + wobble) * (1 + 0.25 * audio.beat);
      } else if (playing) {
        target = 0.06 + 0.04 * Math.sin(now / 400 + i * 0.5); // gentle idle while analysis loads
      }
      L[i] += (target - L[i]) * (target > L[i] ? 0.5 : 0.12);
    }
  }

  const level = (x) => {
    // x in [0,1] -> interpolated level
    const p = Math.min(1, Math.max(0, x)) * (LEVELS - 1);
    const i = Math.floor(p);
    return lerp(audio.levels[i], audio.levels[Math.min(LEVELS - 1, i + 1)], p - i);
  };

  function hexA(color, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return `rgba(30,215,96,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  // ---- drawing primitives ----
  function buildBackground(inst, W, H) {
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const o = off.getContext("2d");
    o.fillStyle = "#121212";
    o.fillRect(0, 0, W, H);
    if (track.cover) {
      const blur = Math.round(Math.max(W, H) / 14);
      o.filter = `blur(${blur}px) brightness(0.4) saturate(1.4)`;
      const side = Math.max(W, H) * 1.3; // cover-fit plus bleed for the blur edges
      o.drawImage(track.cover, (W - side) / 2, (H - side) / 2, side, side);
      o.filter = "none";
    }
    if (inst.mode !== "panel") {
      const v = o.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,0.65)");
      o.fillStyle = v;
      o.fillRect(0, 0, W, H);
    }
    inst.bg = off;
  }

  function drawBackground(ctx, inst, W, H) {
    if (!inst.bg || inst.bg.width !== W || inst.bg.height !== H) buildBackground(inst, W, H);
    ctx.save();
    const zoom = 1 + 0.03 * audio.beat;
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.drawImage(inst.bg, -W / 2, -H / 2, W, H);
    ctx.restore();
  }

  function drawGlow(ctx, cx, cy, inner, reach, c1) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const glow = ctx.createRadialGradient(cx, cy, inner * 0.8, cx, cy, inner + reach * (0.6 + audio.amp));
    glow.addColorStop(0, hexA(c1, 0.35 + 0.35 * audio.beat));
    glow.addColorStop(1, hexA(c1, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  function drawRing(ctx, cx, cy, inner, maxLen, bars, c1, c2, widthScale = 0.55) {
    const total = bars * 2;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, ((2 * Math.PI * inner) / total) * widthScale);
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, inner + maxLen);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    const base = inner + Math.max(3, inner * 0.04);
    for (let j = 0; j < total; j++) {
      const x = (j < bars ? j : total - 1 - j) / (bars - 1);
      const len = 2 + level(x) * maxLen;
      const a = -Math.PI / 2 + (j / total) * Math.PI * 2 + audio.angle * 0.2;
      const cos = Math.cos(a), sin = Math.sin(a);
      ctx.moveTo(cx + cos * base, cy + sin * base);
      ctx.lineTo(cx + cos * (base + len), cy + sin * (base + len));
    }
    ctx.stroke();
  }

  // Smooth outline that bulges with the levels, drawn outside the bar ring.
  function drawBlob(ctx, cx, cy, radius, amp, c2) {
    const N = 96;
    ctx.beginPath();
    for (let j = 0; j <= N; j++) {
      const x = (j <= N / 2 ? j : N - j) / (N / 2);
      const r = radius + level(x) * amp;
      const a = -Math.PI / 2 + (j / N) * Math.PI * 2 - audio.angle * 0.35;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.lineWidth = Math.max(1.5, radius * 0.012);
    ctx.strokeStyle = hexA(c2, 0.35 + 0.4 * audio.beat);
    ctx.stroke();
  }

  function drawDisc(ctx, cx, cy, inner) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.closePath();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = inner * 0.2;
    ctx.fillStyle = "#181818";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.clip();
    if (track.cover) {
      ctx.translate(cx, cy);
      ctx.rotate(audio.angle);
      ctx.drawImage(track.cover, -inner, -inner, inner * 2, inner * 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = "#121212";
    ctx.fill();
  }

  function updateDrawShocks(ctx, inst, cx, cy, inner, scale, dt, c2) {
    if (audio.onset) inst.shocks.push({ r: inner, a: Math.min(0.8, 0.3 + audio.onset * 0.4) });
    ctx.lineWidth = Math.max(1, scale * 0.006);
    for (let i = inst.shocks.length - 1; i >= 0; i--) {
      const s = inst.shocks[i];
      s.r += dt * scale * 0.55;
      s.a *= Math.pow(0.12, dt);
      if (s.a < 0.02) {
        inst.shocks.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, s.r, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(c2, s.a);
      ctx.stroke();
    }
  }

  function updateDrawParticles(ctx, inst, cx, cy, inner, scale, dt, colors) {
    const P = inst.particles;
    const spawn = (n, speed) => {
      for (let k = 0; k < n && P.length < 500; k++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.8);
        P.push({
          x: cx + Math.cos(a) * inner * 1.1,
          y: cy + Math.sin(a) * inner * 1.1,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: 1,
          decay: 0.5 + Math.random() * 0.7,
          size: scale * (0.002 + Math.random() * 0.005),
          color: colors[Math.random() < 0.6 ? 0 : 1],
        });
      }
    };
    if (audio.onset) spawn(Math.round(12 + audio.onset * 40), scale * 0.6);
    if (audio.playing && Math.random() < audio.amp * 0.8) spawn(1, scale * 0.25);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const drag = Math.pow(0.35, dt);
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt * p.decay;
      if (p.life <= 0) {
        P.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.life * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + p.life), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Warp-speed starfield; speed follows loudness and kicks on beats.
  function updateDrawStars(ctx, inst, cx, cy, W, H, dt) {
    if (!inst.stars) {
      inst.stars = Array.from({ length: 160 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
    }
    const speed = (audio.playing ? 0.04 : 0.005) + audio.amp * 0.45 + audio.beat * 0.6;
    const f = Math.max(W, H) * 0.5;
    ctx.save();
    ctx.lineCap = "round";
    for (const s of inst.stars) {
      const z0 = s.z;
      s.z -= dt * speed;
      if (s.z <= 0.02) {
        s.x = Math.random() * 2 - 1;
        s.y = Math.random() * 2 - 1;
        s.z = 1;
        continue;
      }
      const x0 = cx + (s.x / z0) * f * 0.3, y0 = cy + (s.y / z0) * f * 0.3;
      const x1 = cx + (s.x / s.z) * f * 0.3, y1 = cy + (s.y / s.z) * f * 0.3;
      if (x1 < 0 || x1 > W || y1 < 0 || y1 > H) continue;
      const a = Math.min(1, (1 - s.z) * 1.2);
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.7})`;
      ctx.lineWidth = Math.max(0.6, (1 - s.z) * f * 0.006);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Full-width mirrored spectrum along the bottom edge.
  function drawSpectrum(ctx, W, H, c1, c2) {
    const n = 48; // per side
    const gap = W / (n * 2);
    const maxH = H * 0.2;
    const g = ctx.createLinearGradient(0, H, 0, H - maxH);
    g.addColorStop(0, hexA(c1, 0.85));
    g.addColorStop(0.6, hexA(c2, 0.5));
    g.addColorStop(1, hexA(c2, 0));
    ctx.fillStyle = g;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const h = 2 + level(i / (n - 1)) * maxH * (1 - (i / n) * 0.3);
        const x = W / 2 + side * (i + 0.5) * gap;
        ctx.fillRect(x - gap * 0.3, H - h, gap * 0.6, h);
      }
    }
  }

  function drawTitle(ctx, W, H) {
    if (!track.name) return;
    const fam = getComputedStyle(document.body).fontFamily || "sans-serif";
    const size = Math.round(Math.min(W, H) * 0.05);
    const x = W * 0.035, y = H - H * 0.07;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = size * 0.4;
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${size}px ${fam}`;
    ctx.fillText(track.name, x, y - size * 0.75, W * 0.6);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 ${Math.round(size * 0.55)}px ${fam}`;
    ctx.fillText(track.artist, x, y, W * 0.6);
    ctx.restore();
  }

  // ---- per-mode scenes ----
  function drawInstance(inst, now, dt) {
    const { canvas, ctx, mode } = inst;
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return;
    const [c1, c2] = track.colors.length > 1 ? track.colors : [track.colors[0], "#ffffff"];
    drawBackground(ctx, inst, W, H);

    if (mode === "panel") {
      const size = Math.min(W, H);
      const cx = W / 2, cy = H / 2;
      const inner = size * (0.2 + 0.015 * audio.beat);
      const maxLen = size * 0.27;
      drawGlow(ctx, cx, cy, inner, maxLen, c1);
      updateDrawShocks(ctx, inst, cx, cy, inner, size, dt, c2);
      drawRing(ctx, cx, cy, inner, maxLen, 36, c1, c2);
      drawDisc(ctx, cx, cy, inner);
      return;
    }

    // "tall" fills the side panel behind its text; "stage" is the expanded / full screen view.
    const size = Math.min(W, H);
    const cx = W / 2;
    let cy = H / 2;
    if (mode === "tall") {
      const r = inst.anchor?.()?.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      cy = r && r.height ? ((r.top + r.height / 2 - cr.top) / cr.height) * H : H * 0.3;
    }
    const base = mode === "tall" ? W * 0.9 : size;
    const inner = base * ((mode === "tall" ? 0.2 : 0.16) + 0.012 * audio.beat);
    const maxLen = base * (mode === "tall" ? 0.25 : 0.2);

    updateDrawStars(ctx, inst, cx, cy, W, H, dt);
    drawGlow(ctx, cx, cy, inner, maxLen * 1.4, c1);
    updateDrawShocks(ctx, inst, cx, cy, inner, Math.max(W, H), dt, c2);
    if (mode === "stage") drawSpectrum(ctx, W, H, c1, c2);
    updateDrawParticles(ctx, inst, cx, cy, inner, base, dt, [c1, c2]);
    drawBlob(ctx, cx, cy, inner + maxLen * 0.55, maxLen * 0.9, c2);
    drawRing(ctx, cx, cy, inner, maxLen, mode === "stage" ? 64 : 48, c1, c2, mode === "stage" ? 0.5 : 0.55);
    drawDisc(ctx, cx, cy, inner);
    if (mode === "stage") drawTitle(ctx, W, H);

    if (audio.flash > 0.01) {
      ctx.fillStyle = hexA(c2, audio.flash * 0.22);
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---- instances & loop ----
  const instances = new Map(); // mode -> { mode, canvas, ctx, host, bg, shocks, particles, stars, anchor }
  const resizer = new ResizeObserver((entries) => {
    for (const e of entries) {
      const c = e.target;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    }
  });

  function ensureInstance(mode, host, anchor) {
    let inst = instances.get(mode);
    if (inst && inst.host === host && inst.canvas.isConnected) {
      inst.anchor = anchor;
      return inst;
    }
    if (inst) {
      resizer.unobserve(inst.canvas);
      inst.canvas.remove();
    }
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.className = `npv-visualizer npv-visualizer--${mode}`;
    host.appendChild(canvas);
    inst = { mode, canvas, ctx: canvas.getContext("2d"), host, bg: null, shocks: [], particles: [], stars: null, anchor };
    instances.set(mode, inst);
    resizer.observe(canvas);
    return inst;
  }

  function dropInstance(mode) {
    const inst = instances.get(mode);
    if (!inst) return;
    resizer.unobserve(inst.canvas);
    inst.canvas.remove();
    instances.delete(mode);
  }

  let lastFrame = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    // "songchange" doesn't fire for the track already loaded at startup, so also check here.
    if (S.Player.data?.item?.uri && S.Player.data.item.uri !== track.uri) onSongChange();

    let any = false;
    for (const inst of instances.values()) {
      if (!inst.canvas.isConnected) continue;
      inst.visible = inst.canvas.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true;
      any ||= inst.visible;
    }
    positionPill();
    if (!any) return;
    updateAudio(now, dt);
    for (const inst of instances.values()) if (inst.visible && inst.canvas.isConnected) drawInstance(inst, now, dt);
  }

  // ---- side panel Canvas-video toggle pill ----
  const pill = document.createElement("button");
  pill.className = "npv-visualizer-pill";
  pill.addEventListener("click", (e) => {
    e.stopPropagation();
    panelMode = panelMode === "visualizer" ? "canvas" : "visualizer";
    store.set("panelMode", panelMode);
    applyPanelMode();
  });
  const ICON_BARS = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1 9h2v5H1zM5 5h2v9H5zM9 2h2v12H9zM13 7h2v7h-2z"/></svg>';
  const ICON_VIDEO = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M11.196 8 6 5v6z"/><path d="M15.002 1.75A1.75 1.75 0 0 0 13.252 0h-10.5a1.75 1.75 0 0 0-1.75 1.75v12.5c0 .966.783 1.75 1.75 1.75h10.5a1.75 1.75 0 0 0 1.75-1.75zm-1.75-.25a.25.25 0 0 1 .25.25v12.5a.25.25 0 0 1-.25.25h-10.5a.25.25 0 0 1-.25-.25V1.75a.25.25 0 0 1 .25-.25z"/></svg>';

  function applyPanelMode() {
    // Only touch the DOM when the mode changed, or the MutationObserver would loop.
    if (pill.dataset.mode !== panelMode) {
      pill.dataset.mode = panelMode;
      pill.innerHTML = panelMode === "visualizer" ? `${ICON_VIDEO}<span>Switch to Canvas</span>` : `${ICON_BARS}<span>Switch to visualizer</span>`;
    }
    const tall = instances.get("tall");
    if (tall) tall.canvas.style.display = panelMode === "visualizer" ? "" : "none";
  }

  function positionPill() {
    const tall = instances.get("tall");
    const anchor = tall?.canvas.isConnected && tall.anchor?.();
    const aside = anchor && anchor.closest("aside");
    if (!anchor || !aside) {
      pill.style.display = "none";
      return;
    }
    const r = anchor.getBoundingClientRect();
    const ar = aside.getBoundingClientRect();
    const y = r.bottom - 44;
    if (!r.height || y < ar.top + 50 || y > ar.bottom - 40) {
      pill.style.display = "none";
      return;
    }
    pill.style.display = "";
    pill.style.top = `${y}px`;
    pill.style.left = `${r.left + r.width / 2}px`;
  }

  // ---- expanded / full screen mode switcher button ----
  let checkedCls = [];
  let switchingToArtwork = false; // our own click on Spotify's artwork button

  function syncStageButton(group) {
    let btn = group.querySelector(".npv-visualizer-radio");
    const native = [...group.querySelectorAll('button[role="radio"]:not(.npv-visualizer-radio)')];
    if (!native.length) return;
    if (!checkedCls.length) {
      const on = native.find((b) => b.getAttribute("aria-checked") === "true");
      const off = native.find((b) => b.getAttribute("aria-checked") !== "true");
      if (on && off) checkedCls = [...on.classList].filter((c) => !off.classList.contains(c));
    }
    if (!btn) {
      btn = native[0].cloneNode(true);
      btn.classList.add("npv-visualizer-radio");
      btn.removeAttribute("disabled");
      btn.setAttribute("value", "visualizer");
      btn.setAttribute("aria-label", "Show visualizer");
      btn.title = "Show visualizer";
      const wrap = btn.querySelector("span") || btn;
      wrap.innerHTML = ICON_BARS;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        stageOn = true;
        store.set("stageOn", "1");
        mountAll();
      });
      group.appendChild(btn);
      group.addEventListener(
        "click",
        (e) => {
          if (switchingToArtwork || e.target.closest(".npv-visualizer-radio")) return;
          if (e.target.closest('button[role="radio"]')) {
            stageOn = false;
            store.set("stageOn", "0");
            mountAll();
          }
        },
        true
      );
    }
    // The visualizer sits on the artwork stage, which lyrics / Canvas / artist modes don't
    // show, so while it's on keep Spotify in artwork mode.
    const art = native.find((b) => b.getAttribute("value") === "artwork");
    if (stageOn && art && art.getAttribute("aria-checked") !== "true") {
      switchingToArtwork = true;
      art.click();
      switchingToArtwork = false;
    }
    btn.setAttribute("aria-checked", String(stageOn));
    for (const c of checkedCls) btn.classList.toggle(c, stageOn);
    for (const b of native) {
      const isChecked = b.getAttribute("aria-checked") === "true";
      for (const c of checkedCls) b.classList.toggle(c, isChecked && !stageOn);
    }
  }

  // Finds the expanded / full screen stage: the big positioned box around the main artwork.
  function findStage(group) {
    let scope = group;
    let media = null;
    const pick = (root) =>
      [...root.querySelectorAll("img, video")]
        .filter((m) => !m.closest("aside") && !m.closest('[data-testid="home-ad-video-asset"]') && m.clientWidth > 250)
        .sort((a, b) => b.clientWidth - a.clientWidth)[0];
    while (scope && scope !== document.body && !(media = pick(scope))) scope = scope.parentElement;
    if (!media || !scope) return null;
    // Use the top-level box holding the artwork (a sibling of the toolbar). Anything deeper is
    // inside the slide Spotify animates between songs, which would drag the visualizer with it.
    let e = media;
    while (e.parentElement && e.parentElement !== scope) e = e.parentElement;
    return e.parentElement === scope ? e : null;
  }

  let stageMissingSince = 0;
  let stageRetry = 0;

  // ---- mounting ----
  function mountAll() {
    const aside = document.querySelector("aside.NowPlayingView");

    // Side panel: cover overlay.
    const host = aside?.querySelector('[data-testid="cover-drop-target"]') || aside?.querySelector('[data-testid="track-visual-enhancement"]');
    const img = host && [...host.querySelectorAll("img")].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    if (img?.parentElement) ensureInstance("panel", img.parentElement);
    else dropInstance("panel");

    // Side panel: Canvas video replacement.
    const video = aside?.querySelector(".canvasVideoContainerNPV");
    if (video) {
      ensureInstance("tall", video, () => aside.querySelector('[data-testid="track-visual-enhancement"]'));
      if (!pill.isConnected) document.body.appendChild(pill);
      applyPanelMode();
    } else {
      dropInstance("tall");
    }

    // Expanded / full screen view.
    const group = document.querySelector('[role="radiogroup"][aria-label="Media control options"]') ||
      [...document.querySelectorAll('[role="radiogroup"]')].find((g) => g.querySelector('button[value="artwork"]'));
    if (group) syncStageButton(group);
    const stage = group && stageOn && findStage(group);
    if (stage) {
      stageMissingSince = 0;
      ensureInstance("stage", stage);
    } else if (!group || !stageOn) {
      dropInstance("stage");
    } else {
      // The artwork can vanish for a moment mid-transition; don't tear down for that.
      stageMissingSince ||= performance.now();
      if (performance.now() - stageMissingSince > 1000) dropInstance("stage");
      else stageRetry ||= setTimeout(() => {
        stageRetry = 0;
        mountAll();
      }, 1050);
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    canvas.npv-visualizer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;}
    canvas.npv-visualizer--panel{z-index:2;}
    canvas.npv-visualizer--tall{z-index:0;}
    canvas.npv-visualizer--stage{z-index:3;border-radius:0;}
    .npv-visualizer-pill{position:fixed;z-index:5;transform:translateX(-50%);display:flex;align-items:center;gap:6px;
      padding:6px 12px;border:0;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;font:700 12px/1 var(--encore-body-font-stack, inherit);
      cursor:pointer;backdrop-filter:blur(8px);transition:background .15s, transform .15s;}
    .npv-visualizer-pill:hover{background:rgba(0,0,0,.85);transform:translateX(-50%) scale(1.04);}`;
  document.head.appendChild(style);

  let scheduled = false;
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        mountAll();
      });
    }
  }).observe(document.body, { childList: true, subtree: true });

  S.Player.addEventListener("songchange", onSongChange);
  onSongChange();
  mountAll();
  requestAnimationFrame(frame);
})();
