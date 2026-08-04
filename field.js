/* =============================================================================
   GraphABI: the ambient field
   -----------------------------------------------------------------------------
   A live force-directed graph: nodes drift under repulsion and edge springs,
   the topology rewires itself, and neutral signals travel the edges. The field
   is possibility, not evidence. It never renders a pass, break, blast radius,
   witness, or other product conclusion.

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
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  // Coarse-pointer devices get a deliberately cheaper simulation. The field
  // remains alive and touch-aware, but avoids spending a mobile frame budget
  // on forces whose detail is only visible during fine-pointer exploration.
  const coarseField = !finePointer.matches && window.innerWidth <= 900;
  const constrained = Boolean(
    coarseField ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    (connection && connection.saveData)
  );

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
  let pointerX = -9999, pointerY = -9999;
  let pointerVX = 0, pointerVY = 0, pointerSpeed = 0, pointerEnergy = 0;
  let pointerLastX = 0, pointerLastY = 0, pointerLastAt = 0;
  let pointerFine = 0, pointerTouch = 0, touchScroll = 0;
  let touchStartX = 0, touchStartY = 0;
  let touchReleaseTimer = 0;
  let raf = 0;
  let running = false;
  let last = 0;
  let lastFrameAt = 0;
  let mutateAt = 0;
  let spawnAt = 0;
  let constellationAt = 0;
  let splitAt = 0;
  let topologyMode = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ------------------------------------------------------ build graph --- */

  const REST = 132;

  const connected = (a, b) =>
    edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  const degree = (i) => edges.reduce((n, e) => n + (e.a === i || e.b === i ? 1 : 0), 0);

  const addEdge = (a, b, life, expiresAt) => {
    edges.push({
      a, b,
      // A fixed per-edge bow, so curvature is stable while the nodes move.
      bow: rand(-0.3, 0.3),
      life: life === undefined ? 1 : life,
      target: 1,
      expiresAt: expiresAt || 0,
    });
  };

  const build = () => {
    const area = W * H;
    const budget = constrained ? 0.62 : 1;
    const count = Math.max(16, Math.min(constrained ? 38 : 64, Math.round(area / 23000 * budget)));
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
        // Depth. Near nodes are larger, brighter and drift further; far ones
        // sit back. It reads as a volume rather than a flat wireframe.
        z: Math.random(),
        r: 0,
      });
      const n = nodes[nodes.length - 1];
      n.r = 1.1 + n.z * 1.7;
    }

    // k-nearest wiring, degree-capped so no node becomes a hub.
    for (let i = 0; i < nodes.length; i++) {
      const near = nodes
        .map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) }))
        .filter((o) => o.j !== i)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2);
      for (const o of near) {
        if (degree(i) >= 3 || degree(o.j) >= 3) continue;
        if (!connected(i, o.j) && Math.random() < 0.86) addEdge(i, o.j);
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
    pointerEnergy += ((pointerFine || pointerTouch ? 1 : 0) - pointerEnergy) * Math.min(1, dt * 0.09);
    pointerSpeed *= Math.pow(0.89, dt);

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

      // A slow pointer gathers a local constellation around a small ring. A
      // fast pointer opens a corridor through the topology. Both forces fade
      // after release so the graph returns to its spring equilibrium.
      if (pointerEnergy > 0.01) {
        const dx = p.x - pointerX, dy = p.y - pointerY;
        const d2 = dx * dx + dy * dy;
        if (d2 < 52900 && d2 > 1) {
          const d = Math.sqrt(d2);
          const near = 1 - d / 230;
          const fast = Math.min(1, Math.max(0, (pointerSpeed - 0.38) / 0.92));
          const slow = 1 - fast;
          const ring = 34 + p.z * 30;
          const radial = (d - ring) * 0.0048 * near * slow * pointerEnergy;
          p.vx -= dx / d * radial;
          p.vy -= dy / d * radial;

          const orbit = Math.sin(p.px + p.py) * 0.045 * near * slow * pointerEnergy;
          p.vx += -dy / d * orbit;
          p.vy += dx / d * orbit;

          if (fast > 0) {
            const speed = Math.hypot(pointerVX, pointerVY) || 1;
            const ux = pointerVX / speed, uy = pointerVY / speed;
            const side = Math.sign(ux * dy - uy * dx) || (i % 2 ? 1 : -1);
            const split = near * fast * pointerEnergy * (0.72 + p.z * 0.7);
            p.vx += -uy * side * split;
            p.vy += ux * side * split;
          }
        }
      }

      // Section traversal changes equilibrium without turning the field into
      // a scroll animation. Modes alternate between open space, loose
      // subgraphs, and threaded layers.
      if (topologyMode === 1) {
        const anchor = i % 3;
        const ax = W * (0.22 + anchor * 0.28);
        const ay = H * (anchor === 1 ? 0.6 : 0.34);
        p.vx += (ax - p.x) * 0.000055;
        p.vy += (ay - p.y) * 0.000055;
      } else if (topologyMode === 2) {
        const lane = H * (0.24 + (i % 4) * 0.17);
        p.vy += (lane - p.y) * 0.00007;
      }

      // Slow independent wander, so a settled graph still breathes.
      const w = 0.008 + p.z * 0.013;
      p.vx += Math.cos(t * p.ps + p.px) * w;
      p.vy += Math.sin(t * p.ps + p.py) * w;

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

    // Slow exploration creates short-lived local edges. Fast traversal may
    // retire one nearby edge, producing a brief corridor that settles calmly.
    if (pointerEnergy > 0.35 && pointerSpeed < 0.38 && t > constellationAt) {
      constellationAt = t + 0.46;
      const near = nodes
        .map((node, i) => ({ i, d: Math.hypot(node.x - pointerX, node.y - pointerY) }))
        .filter((item) => item.d < 170)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6);
      for (let i = 0; i < near.length - 1; i++) {
        const a = near[i].i, b = near[i + 1].i;
        if (!connected(a, b) && degree(a) < 5 && degree(b) < 5) {
          addEdge(a, b, 0, t + 1.6);
          break;
        }
      }
    }

    if (pointerEnergy > 0.4 && pointerSpeed > 0.9 && t > splitAt) {
      splitAt = t + 0.34;
      let closest = null, closestD = 150;
      for (const edge of edges) {
        if (edge.target === 0 || edge.expiresAt) continue;
        const a = nodes[edge.a], b = nodes[edge.b];
        const d = Math.hypot((a.x + b.x) * 0.5 - pointerX, (a.y + b.y) * 0.5 - pointerY);
        if (d < closestD) { closest = edge; closestD = d; }
      }
      if (closest) closest.target = 0;
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
      if (e.expiresAt && t > e.expiresAt) e.target = 0;
      e.life += (e.target - e.life) * Math.min(1, dt * 0.9);
      if (e.target === 0 && e.life < 0.01) edges.splice(k, 1);
    }
  };

  // Mobile equilibrium keeps the graph cohesive with edge springs and a slow
  // drift, then adds the same short touch convergence used by the full field.
  // It intentionally omits pairwise repulsion, obstacle routing, and topology
  // mutation. Those details reward a fine pointer but are costly under mobile
  // CPU throttling and unnecessary behind compact foreground layouts.
  const stepCoarse = (dt, t) => {
    pointerEnergy += ((pointerTouch ? 1 : 0) - pointerEnergy) * Math.min(1, dt * 0.09);
    pointerSpeed *= Math.pow(0.89, dt);

    for (const e of edges) {
      if (e.life < 0.02) continue;
      const a = nodes[e.a], b = nodes[e.b];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - REST) * 0.0012 * e.life;
      const ux = dx / d * f, uy = dy / d * f;
      a.vx += ux; a.vy += uy;
      b.vx -= ux; b.vy -= uy;
    }

    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      if (pointerEnergy > 0.01) {
        const dx = p.x - pointerX, dy = p.y - pointerY;
        const d2 = dx * dx + dy * dy;
        if (d2 < 40000 && d2 > 1) {
          const d = Math.sqrt(d2);
          const near = 1 - d / 200;
          const ring = 30 + p.z * 22;
          const radial = (d - ring) * 0.0038 * near * pointerEnergy;
          p.vx -= dx / d * radial;
          p.vy -= dy / d * radial;
        }
      }

      const w = 0.005 + p.z * 0.008;
      p.vx += Math.cos(t * p.ps + p.px) * w;
      p.vy += Math.sin(t * p.ps + p.py) * w;
      p.vx *= 0.88; p.vy *= 0.88;
      p.x += p.vx * dt; p.y += p.vy * dt;

      const m = 32;
      if (p.x < m) p.vx += (m - p.x) * 0.018;
      if (p.x > W - m) p.vx -= (p.x - (W - m)) * 0.018;
      if (p.y < m) p.vy += (m - p.y) * 0.018;
      if (p.y > H - m) p.vy -= (p.y - (H - m)) * 0.018;
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

    pulses.push({
      path, i: 0, t: 0,
      speed: rand(0.55, 0.85),
      done: 0,
    });
  };

  const stepPulses = (dt, t) => {
    if (t > spawnAt && pulses.length < (constrained ? 2 : 4)) {
      spawnAt = t + rand(1.1, 2.4);
      spawn();
    }
    for (let k = pulses.length - 1; k >= 0; k--) {
      const p = pulses[k];

      if (p.done > 0) {
        p.done += dt;
        if (p.done > 0.9) pulses.splice(k, 1);
        continue;
      }

      p.t += p.speed * dt;

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

      const az = (a.z + b.z) / 2;
      ctx.strokeStyle = rgba(C.mesh, edgeA * e.life * (0.45 + az * 0.75));
      ctx.lineWidth = 0.6 + az * 0.8;
      ctx.stroke();
    }

    for (const p of nodes) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(C.mesh, nodeA * (0.4 + p.z * 0.8));
      ctx.fill();
    }

    for (const p of pulses) {
      const hop = p.path[p.i];
      const a = nodes[hop.from], b = nodes[hop.to];
      if (!a || !b) continue;
      const c = control(a, b, hop.edge.bow);
      const head = at(a, c, b, p.t);

      const col = C.pulse;
      const fade = p.done > 0 ? Math.max(0, 1 - p.done / 0.9) : 1;

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

      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(col, 0.9 * fade);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = rgba(col, 0.12 * fade);
      ctx.fill();
    }
  };

  // Batch coarse-field paths to keep Canvas calls and style changes bounded.
  // Depth is preserved in node radius, while the full field keeps per-edge
  // depth, transient topology, and pulse trails for desktop exploration.
  const drawCoarse = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const e of edges) {
      if (e.life < 0.02) continue;
      const a = nodes[e.a], b = nodes[e.b];
      const c = control(a, b, e.bow);
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    }
    ctx.strokeStyle = rgba(C.mesh, C.isDark ? 0.28 : 0.22);
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.beginPath();
    for (const p of nodes) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = rgba(C.mesh, C.isDark ? 0.48 : 0.40);
    ctx.fill();

    for (const p of pulses) {
      const hop = p.path[p.i];
      const a = nodes[hop.from], b = nodes[hop.to];
      if (!a || !b) continue;
      const head = at(a, control(a, b, hop.edge.bow), b, p.t);
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(C.pulse, 0.72);
      ctx.fill();
    }
  };

  /* ------------------------------------------------------------ loop --- */

  const frame = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const cadence = coarseField ? 48 : constrained ? 30 : 0;
    if (cadence && now - lastFrameAt < cadence) return;
    lastFrameAt = now;
    if (!last) last = now;
    // Clamp dt so a backgrounded tab never resumes with an exploded step.
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    // Forces are tuned per 60 fps frame, so dt is expressed in frame units.
    if (coarseField) stepCoarse(dt * 60, t);
    else step(dt * 60, t);
    stepPulses(dt, t);
    if (coarseField) drawCoarse();
    else draw();
  };

  const start = () => {
    if (running || reduced.matches) return;
    running = true;
    last = 0;
    lastFrameAt = 0;
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  /* ------------------------------------------------------------ size --- */

  const resize = () => {
    dpr = Math.min(constrained ? 1.25 : 2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    if (!coarseField) measure();
  };

  // Reduced motion: run the simulation to rest off-screen, paint one frame,
  // and never start a loop. The field becomes a still topology, not nothing.
  const settle = () => {
    stop();
    const iterations = constrained ? 48 : 120;
    for (let i = 0; i < iterations; i++) {
      if (coarseField) stepCoarse(1, 0);
      else step(1, 0);
    }
    pulses = [];
    if (coarseField) drawCoarse();
    else draw();
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
      if (Math.abs(w - lastW) < 2 && canvas.width === Math.round(w * dpr)) {
        if (!coarseField) measure();
        return;
      }
      lastW = w;
      resize();
      if (reduced.matches) settle();
    }, 180);
  }, { passive: true });

  if (!coarseField) {
    window.addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });
  }

  const updatePointer = (event, isFine) => {
    const now = performance.now();
    const elapsed = Math.max(8, now - pointerLastAt);
    const vx = (event.clientX - pointerLastX) / elapsed;
    const vy = (event.clientY - pointerLastY) / elapsed;
    pointerVX += (vx - pointerVX) * 0.45;
    pointerVY += (vy - pointerVY) * 0.45;
    pointerSpeed += (Math.hypot(vx, vy) - pointerSpeed) * 0.35;
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerLastX = event.clientX;
    pointerLastY = event.clientY;
    pointerLastAt = now;
    if (isFine) pointerFine = 1;
  };

  if (finePointer.matches) {
    window.addEventListener("pointermove", (event) => {
      updatePointer(event, true);
    }, { passive: true });
    window.addEventListener("pointerleave", () => { pointerFine = 0; }, { passive: true });
    document.addEventListener("mouseleave", () => { pointerFine = 0; }, { passive: true });
  }

  // Touch influence is short and passive. It never prevents default, never
  // starts over a control, and gives way as soon as a vertical scroll begins.
  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" || event.target.closest("a,button,input,select,textarea,summary,[role='button']")) return;
    touchStartX = event.clientX;
    touchStartY = event.clientY;
    clearTimeout(touchReleaseTimer);
    touchScroll = 0;
    pointerTouch = 1;
    pointerSpeed = 0;
    updatePointer(event, false);
  }, { passive: true });
  window.addEventListener("pointermove", (event) => {
    if (!pointerTouch || event.pointerType !== "touch") return;
    const dx = event.clientX - touchStartX;
    const dy = event.clientY - touchStartY;
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
      touchScroll = 1;
      pointerTouch = 0;
      return;
    }
    if (!touchScroll && Math.hypot(dx, dy) < 84) updatePointer(event, false);
  }, { passive: true });
  const releaseTouch = () => {
    if (touchScroll) { pointerTouch = 0; touchScroll = 0; return; }
    touchReleaseTimer = setTimeout(() => { pointerTouch = 0; }, 420);
  };
  window.addEventListener("pointerup", releaseTouch, { passive: true });
  window.addEventListener("pointercancel", releaseTouch, { passive: true });

  if (!coarseField && "IntersectionObserver" in window) {
    const sections = [...document.querySelectorAll("main > section")];
    const sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) topologyMode = Math.abs(sections.indexOf(visible.target)) % 3;
    }, { rootMargin: "-28% 0px -28% 0px", threshold: [0.05, 0.35, 0.7] });
    sections.forEach((section) => sectionObserver.observe(section));
  }
  if (!coarseField) window.addEventListener("load", measure);
  // Text reflowing after a late font swap moves every obstacle the field
  // routes around, so the cached document-space rects have to be retaken.
  if (!coarseField && document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  document.addEventListener("visibilitychange", () => {
    document.hidden ? stop() : start();
  });

  dark.addEventListener("change", () => {
    readPalette();
    if (reduced.matches) coarseField ? drawCoarse() : draw();
  });

  reduced.addEventListener("change", () => {
    if (reduced.matches) settle();
    else { build(); start(); }
  });
})();
