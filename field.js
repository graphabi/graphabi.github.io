/* =============================================================================
   GraphABI — the ambient field
   -----------------------------------------------------------------------------
   A live force-directed graph: nodes drift under repulsion and edge springs,
   the topology rewires itself, and semantic pulses travel the edges. Most
   resolve. Some stop mid-edge, cut, and take their downstream path with them.

   This is the world before GraphABI: meaning moving through a graph, breaking
   quietly, healing, and nobody watching. Every product surface on the page is
   the deliberate opposite - deterministic, explained, and stopped.

   Canvas 2D, no dependencies. Three.js would buy nothing here and cost ~600 KB
   against a documented performance budget; the interesting work is the
   simulation, not the rasteriser.
   ========================================================================== */

(() => {
  "use strict";

  const canvas = document.querySelector("[data-field]");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dark = window.matchMedia("(prefers-color-scheme: dark)");

  /* ---------------------------------------------------------- palette --- */

  const C = {};
  const readPalette = () => {
    const s = getComputedStyle(document.documentElement);
    const rgb = (name, fallback) => {
      const v = s.getPropertyValue(name).trim() || fallback;
      const h = v.replace("#", "");
      const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      const i = parseInt(n, 16);
      return [(i >> 16) & 255, (i >> 8) & 255, i & 255];
    };
    C.edge = rgb("--edge", "#556070");
    C.pulse = rgb("--pulse", "#A78BFA");
    C.fail = rgb("--fail", "#EF4444");
    C.pass = rgb("--pass", "#22C55E");
    C.isDark = dark.matches;
    // A trace of violet in the mesh: inactive structure still belongs to the
    // same system as the meaning flowing over it.
    C.mesh = C.edge.map((v, i) => Math.round(v * 0.78 + C.pulse[i] * 0.22));
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* ------------------------------------------------------------ state --- */

  let W = 0, H = 0, dpr = 1;
  let nodes = [];
  let edges = [];
  let pulses = [];
  let obstacles = [];
  let scrollY = window.scrollY || 0;
  let raf = 0;
  let running = false;
  let last = 0;
  let mutateAt = 0;
  let spawnAt = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ------------------------------------------------------ build graph --- */

  const REST = 132;

  const connected = (a, b) =>
    edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  const degree = (i) => edges.reduce((n, e) => n + (e.a === i || e.b === i ? 1 : 0), 0);

  const addEdge = (a, b, life) => {
    edges.push({
      a, b,
      // A fixed per-edge bow, so curvature is stable while the nodes move.
      bow: rand(-0.3, 0.3),
      life: life === undefined ? 1 : life,
      target: 1,
      blast: 0,
    });
  };

  const build = () => {
    const area = W * H;
    const count = Math.max(18, Math.min(78, Math.round(area / 18500)));
    nodes = [];
    edges = [];
    pulses = [];

    // Relaxed scatter: seed on a jittered grid so the field starts even
    // rather than clumped, then let the simulation take over.
    const cols = Math.ceil(Math.sqrt(count * (W / H)));
    const rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const cx = ((i % cols) + 0.5) / cols;
      const cy = (((i / cols) | 0) + 0.5) / rows;
      nodes.push({
        x: cx * W + rand(-W / cols / 2.4, W / cols / 2.4),
        y: cy * H + rand(-H / rows / 2.4, H / rows / 2.4),
        vx: 0, vy: 0,
        // Independent slow wander keeps the field breathing once forces settle.
        px: rand(0, Math.PI * 2), py: rand(0, Math.PI * 2),
        ps: rand(0.12, 0.3),
        r: rand(1.3, 2.5),
      });
    }

    // k-nearest wiring, degree-capped so no node becomes a hub.
    for (let i = 0; i < nodes.length; i++) {
      const near = nodes
        .map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) }))
        .filter((o) => o.j !== i)
        .sort((p, q) => p.d - q.d)
        .slice(0, 3);
      for (const o of near) {
        if (degree(i) >= 3 || degree(o.j) >= 4) continue;
        if (!connected(i, o.j) && Math.random() < 0.9) addEdge(i, o.j);
      }
    }
  };

  // Edges are handed out by reference, never by index: topology mutation
  // splices the array while pulses are still travelling across it.
  const neighbours = (i) => {
    const out = [];
    for (const e of edges) {
      if (e.life < 0.6 || e.target === 0) continue;
      if (e.a === i) out.push({ edge: e, to: e.b });
      else if (e.b === i) out.push({ edge: e, to: e.a });
    }
    return out;
  };

  /* ------------------------------------------------------- obstacles --- */

  // Cached in document coordinates, so the per-frame cost is one subtraction
  // and never a forced layout.
  const OBSTACLE_SELECTOR = "h1, .hero-lede, .hero-actions, .install-line, .section-heading, .pulse-scene";

  const measure = () => {
    const top = window.scrollY;
    obstacles = [...document.querySelectorAll(OBSTACLE_SELECTOR)].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - 28, y: r.top + top - 28, w: r.width + 56, h: r.height + 56 };
    });
  };

  /* ---------------------------------------------------------- physics --- */

  const step = (dt, t) => {
    const n = nodes.length;

    // Node-node repulsion. O(n^2) is genuinely cheaper than a spatial index
    // at this scale, and the constant factor is what matters at 60 fps.
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 26000 || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const f = (1 - d / 162) * 38 / d;
        dx *= f; dy *= f;
        a.vx -= dx; a.vy -= dy;
        b.vx += dx; b.vy += dy;
      }
    }

    // Edge springs toward a rest length.
    for (const e of edges) {
      if (e.life < 0.02) continue;
      const a = nodes[e.a], b = nodes[e.b];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - REST) * 0.0016 * e.life;
      const ux = dx / d * f, uy = dy / d * f;
      a.vx += ux; a.vy += uy;
      b.vx -= ux; b.vy -= uy;
    }

    for (let i = 0; i < n; i++) {
      const p = nodes[i];

      // Content repulsion: the type carves space out of the graph.
      for (const o of obstacles) {
        const oy = o.y - scrollY;
        if (oy > H || oy + o.h < 0) continue;
        if (p.x < o.x || p.x > o.x + o.w || p.y < oy || p.y > oy + o.h) continue;
        const left = p.x - o.x, right = o.x + o.w - p.x;
        const up = p.y - oy, down = oy + o.h - p.y;
        const m = Math.min(left, right, up, down);
        const push = 0.5;
        if (m === left) p.vx -= push * (1 - left / o.w);
        else if (m === right) p.vx += push * (1 - right / o.w);
        else if (m === up) p.vy -= push * (1 - up / o.h);
        else p.vy += push * (1 - down / o.h);
      }

      // Slow independent wander, so a settled graph still breathes.
      p.vx += Math.cos(t * p.ps + p.px) * 0.014;
      p.vy += Math.sin(t * p.ps + p.py) * 0.014;

      p.vx *= 0.90; p.vy *= 0.90;

      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 1.6) { p.vx = p.vx / sp * 1.6; p.vy = p.vy / sp * 1.6; }

      p.x += p.vx * dt; p.y += p.vy * dt;

      // Soft walls, not wrapping: wrapping makes edges jump across the screen.
      const m = 40;
      if (p.x < m) p.vx += (m - p.x) * 0.02;
      if (p.x > W - m) p.vx -= (p.x - (W - m)) * 0.02;
      if (p.y < m) p.vy += (m - p.y) * 0.02;
      if (p.y > H - m) p.vy -= (p.y - (H - m)) * 0.02;
    }

    // Topology mutation: retire an overstretched edge, grow a plausible one.
    if (t > mutateAt) {
      mutateAt = t + rand(2.4, 4.6);
      let worst = -1, worstD = 0;
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k];
        if (e.target === 0) continue;
        const d = Math.hypot(nodes[e.b].x - nodes[e.a].x, nodes[e.b].y - nodes[e.a].y);
        if (d > worstD) { worstD = d; worst = k; }
      }
      if (worst >= 0 && worstD > REST * 1.5) edges[worst].target = 0;

      const a = (Math.random() * nodes.length) | 0;
      let best = -1, bestD = Infinity;
      for (let j = 0; j < nodes.length; j++) {
        if (j === a || connected(a, j) || degree(j) >= 4) continue;
        const d = Math.hypot(nodes[j].x - nodes[a].x, nodes[j].y - nodes[a].y);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best >= 0 && bestD < REST * 1.7 && degree(a) < 4) addEdge(a, best, 0);
    }

    for (let k = edges.length - 1; k >= 0; k--) {
      const e = edges[k];
      e.life += (e.target - e.life) * Math.min(1, dt * 0.9);
      if (e.blast > 0) e.blast = Math.max(0, e.blast - dt * 0.55);
      if (e.target === 0 && e.life < 0.01) edges.splice(k, 1);
    }
  };

  /* ---------------------------------------------------------- pulses --- */

  const spawn = () => {
    if (!edges.length) return;
    const start = (Math.random() * nodes.length) | 0;
    const path = [];
    let cur = start, prev = -1;
    const hops = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < hops; i++) {
      const opts = neighbours(cur).filter((o) => o.to !== prev);
      if (!opts.length) break;
      const nx = pick(opts);
      path.push({ edge: nx.edge, from: cur, to: nx.to });
      prev = cur;
      cur = nx.to;
    }
    if (path.length < 2) return;

    // Roughly one in four never arrives.
    const breaking = Math.random() < 0.26;
    pulses.push({
      path, i: 0, t: 0,
      speed: rand(0.55, 0.85),
      breaking,
      breakAt: breaking ? 1 + ((Math.random() * (path.length - 1)) | 0) : -1,
      broke: 0,
      done: 0,
    });
  };

  const stepPulses = (dt, t) => {
    if (t > spawnAt && pulses.length < 4) {
      spawnAt = t + rand(1.1, 2.4);
      spawn();
    }
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k];

      if (p.broke > 0) {
        p.broke += dt;
        if (p.broke > 2.2) pulses.splice(k, 1);
        continue;
      }
      if (p.done > 0) {
        p.done += dt;
        if (p.done > 0.9) pulses.splice(k, 1);
        continue;
      }

      p.t += p.speed * dt;

      if (p.i === p.breakAt && p.t >= 0.5) {
        p.t = 0.5;
        p.broke = 0.001;
        // Everything leaving the node it never reached is now suspect.
        const hop = p.path[p.i];
        for (const e of edges) {
          if (e.a === hop.to || e.b === hop.to) e.blast = 1;
        }
        continue;
      }

      if (p.t >= 1) {
        p.t = 0;
        p.i++;
        if (p.i >= p.path.length) { p.i = p.path.length - 1; p.t = 1; p.done = 0.001; }
      }
    }
  };

  /* ----------------------------------------------------------- paint --- */

  // Quadratic control point for an edge, bowed perpendicular to its span.
  const control = (a, b, bow) => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    return { x: mx - dy * bow, y: my + dx * bow };
  };

  const at = (a, c, b, t) => {
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
  };

  const draw = () => {
    ctx.clearRect(0, 0, W, H);

    const edgeA = C.isDark ? 0.42 : 0.34;
    const nodeA = C.isDark ? 0.62 : 0.50;

    ctx.lineCap = "round";

    for (const e of edges) {
      if (e.life < 0.02) continue;
      const a = nodes[e.a], b = nodes[e.b];
      const c = control(a, b, e.bow);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);

      if (e.blast > 0.01) {
        ctx.setLineDash([3, 7]);
        ctx.strokeStyle = rgba(C.fail, 0.30 * e.blast * e.life);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = rgba(C.mesh, edgeA * e.life * (1 - e.blast * 0.5));
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const p of nodes) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(C.mesh, nodeA);
      ctx.fill();
    }

    for (const p of pulses) {
      const hop = p.path[p.i];
      const a = nodes[hop.from], b = nodes[hop.to];
      if (!a || !b) continue;
      const c = control(a, b, hop.edge.bow);
      const head = at(a, c, b, p.t);

      const broke = p.broke > 0;
      const col = broke ? C.fail : C.pulse;
      const fade = broke ? Math.max(0, 1 - (p.broke - 1.2) / 1.0) : 1;

      // Trail: a short sampled span of the same curve behind the head.
      const t0 = Math.max(0, p.t - 0.34);
      ctx.beginPath();
      for (let s = 0; s <= 8; s++) {
        const q = at(a, c, b, t0 + (p.t - t0) * (s / 8));
        s === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = rgba(col, 0.34 * fade);
      ctx.lineWidth = 1.6;
      ctx.stroke();

      if (broke) {
        // The mark: the same interrupted edge the logo is built from.
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const grow = Math.min(1, p.broke * 7);
        ctx.save();
        ctx.translate(head.x, head.y);
        ctx.rotate(ang);
        ctx.strokeStyle = rgba(C.fail, 0.85 * fade);
        ctx.lineWidth = 1.5;
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(-3.5 * grow, sy * 4.5 * grow);
          ctx.lineTo(3.5 * grow, sy * 1 * grow);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, 0.95 * fade);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, 0.14 * fade);
        ctx.fill();
      }

      // Arrival: the consumer node acknowledges a pulse that made it.
      if (p.done > 0) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3 + p.done * 9, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.pass, Math.max(0, 0.5 - p.done * 0.6));
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  };

  /* ------------------------------------------------------------ loop --- */

  const frame = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    // Clamp dt so a backgrounded tab never resumes with an exploded step.
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    // Forces are tuned per 60 fps frame, so dt is expressed in frame units.
    step(dt * 60, t);
    stepPulses(dt, t);
    draw();
  };

  const start = () => {
    if (running || reduced.matches) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  /* ------------------------------------------------------------ size --- */

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    measure();
    if (reduced.matches) settle();
  };

  // Reduced motion: run the simulation to rest off-screen, paint one frame,
  // and never start a loop. The field becomes a still topology, not nothing.
  const settle = () => {
    stop();
    for (let i = 0; i < 220; i++) step(1, 0);
    pulses = [];
    draw();
  };

  /* --------------------------------------------------------- observe --- */

  readPalette();
  resize();

  if (reduced.matches) settle(); else start();

  let resizeTimer = 0;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    // Mobile browsers fire resize on URL-bar collapse; only a width change
    // is worth rebuilding the graph for.
    const w = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(w - lastW) < 2 && canvas.width === Math.round(w * dpr)) { measure(); return; }
      lastW = w;
      resize();
    }, 180);
  }, { passive: true });

  window.addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });
  window.addEventListener("load", measure);
  // Text reflowing after a late font swap moves every obstacle the field
  // routes around, so the cached document-space rects have to be retaken.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  document.addEventListener("visibilitychange", () => {
    document.hidden ? stop() : start();
  });

  dark.addEventListener("change", () => { readPalette(); if (reduced.matches) draw(); });

  reduced.addEventListener("change", () => {
    if (reduced.matches) settle();
    else { build(); start(); }
  });
})();
