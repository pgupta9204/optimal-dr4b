/*
 * renderer.js — interactive 2D canvas visualization of VEX parallelogram lifts.
 *
 * Renders:
 *   - VEX structural C-channels with realistic metal styling & 0.5" hole grids.
 *   - Ground tower & middle towers.
 *   - Pivot screw joints with bearing flat styling.
 *   - Standoff posts with interactive drag-to-snap on the 0.5" grid.
 *   - Rubber bands rendered with tension heat-map color & thickness.
 *   - Center of mass indicator & height measuring tape.
 *   - Pan & zoom with smooth mouse wheel and touch support.
 */
(function (root) {
  'use strict';
  const LP = root.LiftPhysics;

  class LiftRenderer {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = Object.assign({
        showGrid: true,
        showHoles: true,
        showCoM: true,
        showDimensions: true,
        showInterference: true,
        halfCut: true,          // Follow single-hole skeleton lines (no y-offset on bars)
        showSkeletonLines: true,// CAD-style skeleton construction lines
        showGears: true,        // Middle tower synchronization gears
        unit: 'in',             // 'in' or 'holes'
      }, options);

      // View transform
      this.scale = 24; // pixels per inch
      this.panX = 140; // origin x on canvas
      this.panY = 0;   // computed dynamically to fit tower
      this.isDragging = false;
      this.dragMode = null; // 'pan' or 'post'
      this.draggedPost = null; // { groupIndex, pointIndex, link, a, b }
      this.hoveredPost = null;
      this.hoveredHole = null;

      this.currentTheta = 20 * LP.DEG;
      this.model = null;
      this.groups = [];
      this.band = LP.BAND_PRESETS['64'];

      this.onPostChanged = null;
      this.onThetaChanged = null;

      this._setupEvents();
      this.resize();
    }

    setModel(model, groups, band) {
      this.model = model;
      this.groups = groups || [];
      if (band) this.band = band;
      this.render();
    }

    setTheta(thetaRad) {
      this.currentTheta = thetaRad;
      this.render();
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(100, Math.floor(rect.width));
      const h = Math.max(100, Math.floor(rect.height));

      if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
      }
      this.width = w;
      this.height = h;
      if (this.panY === 0) {
        this.panY = h * 0.72; // default ground plane location
      }
      this.render();
    }

    fitView() {
      if (!this.model) return;
      // sample bounding box across range
      const cfg = this.model.cfg;
      let minX = -3, maxX = 20, minY = -2, maxY = 30;
      for (let deg = cfg.thetaMin; deg <= cfg.thetaMax; deg += 10) {
        const F = LP.framesAt(this.model, deg * LP.DEG);
        for (const l of this.model.links) {
          const r = LP.linkRange(l, { barExt: 1, barOff: 1, linkReach: 2, linkExt: 2 });
          const p1 = LP.pointAt(F[l.idx], r.aMin, r.bMin);
          const p2 = LP.pointAt(F[l.idx], r.aMax, r.bMax);
          minX = Math.min(minX, p1[0], p2[0]);
          maxX = Math.max(maxX, p1[0], p2[0]);
          minY = Math.min(minY, p1[1], p2[1]);
          maxY = Math.max(maxY, p1[1], p2[1]);
        }
      }
      const padX = 5, padY = 5;
      const spanX = (maxX - minX) + padX * 2;
      const spanY = (maxY - minY) + padY * 2;
      const scaleX = this.width / spanX;
      const scaleY = this.height / spanY;
      this.scale = Math.max(14, Math.min(52, Math.min(scaleX, scaleY)));
      this.panX = this.width / 2 - ((minX + maxX) / 2) * this.scale;
      this.panY = this.height / 2 + ((minY + maxY) / 2) * this.scale;
      this.render();
    }

    // World to Screen and Screen to World
    worldToScreen(x, y) {
      return [
        this.panX + x * this.scale,
        this.panY - y * this.scale,
      ];
    }

    screenToWorld(sx, sy) {
      return [
        (sx - this.panX) / this.scale,
        (this.panY - sy) / this.scale,
      ];
    }

    _setupEvents() {
      let startX = 0, startY = 0;
      let initialPanX = 0, initialPanY = 0;

      const getPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
      };

      this.canvas.addEventListener('mousedown', (e) => {
        const [sx, sy] = getPos(e);
        startX = sx; startY = sy;
        initialPanX = this.panX; initialPanY = this.panY;

        // Check if clicked near an existing post
        const hit = this._hitTestPost(sx, sy);
        if (hit) {
          this.dragMode = 'post';
          this.draggedPost = hit;
          this.canvas.style.cursor = 'grabbing';
          return;
        }

        this.dragMode = 'pan';
        this.canvas.style.cursor = 'move';
      });

      window.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (this.dragMode === 'pan') {
          this.panX = initialPanX + (sx - startX);
          this.panY = initialPanY + (sy - startY);
          this.render();
          return;
        }

        if (this.dragMode === 'post' && this.draggedPost && this.model) {
          const [wx, wy] = this.screenToWorld(sx, sy);
          const F = LP.framesAt(this.model, this.currentTheta);
          const f = F[this.draggedPost.link];
          // convert world to local
          const loc = LP.worldToLocal(f, wx, wy);
          const link = this.model.links[this.draggedPost.link];

          const isHalfCut = !!this.options.halfCut;
          // on half-cuts: bars have no y-offset (b=0), uprights have no x-offset (a=0)
          const rawA = isHalfCut && link.kind !== 'bar' ? 0 : loc[0];
          const rawB = isHalfCut && link.kind === 'bar' ? 0 : loc[1];

          // constrain strictly to physical metal holes, avoiding occupied pivot joints
          const [clA, clB] = LP.nearestNonPivot(link, rawA, rawB, { halfCut: isHalfCut });

          const grp = this.groups[this.draggedPost.groupIndex];
          if (grp && grp.pts[this.draggedPost.pointIndex]) {
            grp.pts[this.draggedPost.pointIndex].a = clA;
            grp.pts[this.draggedPost.pointIndex].b = clB;
            this.render();
            if (this.onPostChanged) this.onPostChanged(this.draggedPost);
          }
          return;
        }

        // Hover test
        if (sx >= 0 && sx <= this.width && sy >= 0 && sy <= this.height) {
          const hit = this._hitTestPost(sx, sy);
          if (hit !== this.hoveredPost) {
            this.hoveredPost = hit;
            this.canvas.style.cursor = hit ? 'grab' : 'default';
            this.render();
          }
        }
      });

      window.addEventListener('mouseup', () => {
        if (this.dragMode === 'post') {
          this.canvas.style.cursor = this.hoveredPost ? 'grab' : 'default';
        } else {
          this.canvas.style.cursor = 'default';
        }
        this.dragMode = null;
        this.draggedPost = null;
      });

      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [sx, sy] = getPos(e);
        const [wx, wy] = this.screenToWorld(sx, sy);
        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
        const newScale = Math.max(10, Math.min(90, this.scale * zoomFactor));

        // keep world point under mouse fixed
        this.panX = sx - wx * newScale;
        this.panY = sy + wy * newScale;
        this.scale = newScale;
        this.render();
      }, { passive: false });
    }

    _hitTestPost(sx, sy) {
      if (!this.model || !this.groups) return null;
      const F = LP.framesAt(this.model, this.currentTheta);
      const hitRadius = 14;

      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        for (let pi = 0; pi < grp.pts.length; pi++) {
          const pt = grp.pts[pi];
          const f = F[pt.link];
          const w = LP.pointAt(f, pt.a, pt.b);
          const [psx, psy] = this.worldToScreen(w[0], w[1]);
          const d = Math.hypot(sx - psx, sy - psy);
          if (d <= hitRadius) {
            return {
              groupIndex: gi,
              pointIndex: pi,
              link: pt.link,
              a: pt.a,
              b: pt.b,
              screenX: psx,
              screenY: psy,
            };
          }
        }
      }
      return null;
    }

    render() {
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      const w = this.width;
      const h = this.height;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background grid
      this._drawBackgroundGrid(ctx, w, h);

      if (!this.model) {
        ctx.restore();
        return;
      }

      const F = LP.framesAt(this.model, this.currentTheta);
      const segs = LP.linkSegments(this.model, F);

      // Draw Ground Reference line
      this._drawGroundPlane(ctx);

      // Draw Structural Links (C-channels, Towers, Links)
      this._drawStructure(ctx, F);

      // Draw Rubber Bands
      this._drawBands(ctx, F, segs);

      // Draw Standoff Posts
      this._drawPosts(ctx, F);

      // Draw Center of Mass and Height callouts
      if (this.options.showCoM) {
        this._drawCenterOfMass(ctx, F);
      }
      if (this.options.showDimensions) {
        this._drawHeightTape(ctx, F);
      }

      ctx.restore();
    }

    _drawBackgroundGrid(ctx, w, h) {
      ctx.fillStyle = '#0f141c';
      ctx.fillRect(0, 0, w, h);

      if (!this.options.showGrid) return;

      const gridSpacingInches = 1.0;
      const pxStep = gridSpacingInches * this.scale;
      if (pxStep < 10) return;

      const startX = this.panX % pxStep;
      const startY = this.panY % pxStep;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x < w; x += pxStep) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      for (let y = startY; y < h; y += pxStep) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Major 5-inch lines
      const majorStep = 5.0 * this.scale;
      if (majorStep >= 30) {
        const mStartX = this.panX % majorStep;
        const mStartY = this.panY % majorStep;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.beginPath();
        for (let x = mStartX; x < w; x += majorStep) {
          ctx.moveTo(x, 0); ctx.lineTo(x, h);
        }
        for (let y = mStartY; y < h; y += majorStep) {
          ctx.moveTo(0, y); ctx.lineTo(w, y);
        }
        ctx.stroke();
      }
    }

    _drawGroundPlane(ctx) {
      const [gx0, gy0] = this.worldToScreen(-12, 0);
      const [gx1, gy1] = this.worldToScreen(36, 0);

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(gx0, gy0);
      ctx.lineTo(gx1, gy1);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText('GROUND PIVOT DATUM (Y = 0)', gx0 + 8, gy0 + 14);
    }

    _drawStructure(ctx, F) {
      // 1. Draw CAD-style skeleton construction lines (dash-dot through centerlines)
      if (this.options.showSkeletonLines) {
        this._drawSkeletonLines(ctx, F);
      }

      // 2. Draw Middle Tower Synchronization Gears (meshing red gears)
      if (this.options.showGears && this.model.hasS2) {
        this._drawMiddleTowerGears(ctx, F);
      }

      // 3. Draw links ordered: ground tower -> intermediate links -> arms -> end effector
      for (const link of this.model.links) {
        const f = F[link.idx];
        if (link.kind === 'ground') {
          this._drawTower(ctx, link, f, false);
        } else if (link.kind === 'link') {
          this._drawTower(ctx, link, f, link.isEnd);
        } else if (link.kind === 'bar') {
          this._drawBar(ctx, link, f);
        }
      }

      // Draw all joint pivot bearings
      for (const link of this.model.links) {
        const f = F[link.idx];
        for (const pv of link.pivots) {
          const w = LP.pointAt(f, pv[0], pv[1]);
          const [sx, sy] = this.worldToScreen(w[0], w[1]);

          // Outer bearing flat
          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(4, 0.35 * this.scale), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Screw center (brass/steel)
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(2, 0.16 * this.scale), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    _drawSkeletonLines(ctx, F) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([12, 4, 3, 4]); // CAD center/construction dash-dot

      for (const link of this.model.links) {
        const f = F[link.idx];
        if (link.kind === 'bar') {
          const ext = 2.5;
          const p0 = LP.pointAt(f, -ext, 0);
          const p1 = LP.pointAt(f, link.length + ext, 0);
          const [s0x, s0y] = this.worldToScreen(p0[0], p0[1]);
          const [s1x, s1y] = this.worldToScreen(p1[0], p1[1]);
          ctx.beginPath();
          ctx.moveTo(s0x, s0y);
          ctx.lineTo(s1x, s1y);
          ctx.stroke();
        } else {
          let minP = Infinity, maxP = -Infinity;
          for (const p of link.pivots) {
            minP = Math.min(minP, p[1]);
            maxP = Math.max(maxP, p[1]);
          }
          if (isFinite(minP)) {
            const ext = 4.0;
            const p0 = LP.pointAt(f, 0, minP - ext);
            const p1 = LP.pointAt(f, 0, maxP + ext);
            const [s0x, s0y] = this.worldToScreen(p0[0], p0[1]);
            const [s1x, s1y] = this.worldToScreen(p1[0], p1[1]);
            ctx.beginPath();
            ctx.moveTo(s0x, s0y);
            ctx.lineTo(s1x, s1y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    _drawMiddleTowerGears(ctx, F) {
      if (!this.model.hasS2) return;
      const midTower = this.model.links.find((l) => l.name === 'Middle tower');
      if (!midTower) return;
      const f = F[midTower.idx];
      const cfg = this.model.cfg;
      const s1TopY = cfg.stage1.type === '6bar' ? cfg.stage1.s2 : cfg.stage1.s;
      const s2BotY = cfg.stage2.h;
      const dy = s2BotY - s1TopY;
      if (dy <= 0.4) return;

      const r = dy / 2;
      const pxR = r * this.scale;
      if (pxR < 6) return;

      const centers = [
        LP.pointAt(f, 0, s1TopY),
        LP.pointAt(f, 0, s2BotY),
      ];

      ctx.save();
      for (let i = 0; i < 2; i++) {
        const c = centers[i];
        const [cx, cy] = this.worldToScreen(c[0], c[1]);
        const rot = i === 0 ? this.currentTheta : -this.currentTheta;

        // Gear Outer Circle (Red VEX High Strength Gear)
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.arc(cx, cy, pxR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#991b1b';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Gear teeth rim
        const teeth = 28;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.0;
        for (let t = 0; t < teeth; t++) {
          const ang = rot + (t * Math.PI * 2) / teeth;
          const x0 = cx + Math.cos(ang) * (pxR - 2);
          const y0 = cy + Math.sin(ang) * (pxR - 2);
          const x1 = cx + Math.cos(ang) * (pxR + 3);
          const y1 = cy + Math.sin(ang) * (pxR + 3);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }

        // Dark recessed body
        ctx.fillStyle = '#7f1d1d';
        ctx.beginPath();
        ctx.arc(cx, cy, pxR * 0.76, 0, Math.PI * 2);
        ctx.fill();

        // 5 circular lightening holes
        ctx.fillStyle = '#1e293b';
        for (let h = 0; h < 5; h++) {
          const ang = rot + (h * Math.PI * 2) / 5;
          const hx = cx + Math.cos(ang) * (pxR * 0.48);
          const hy = cy + Math.sin(ang) * (pxR * 0.48);
          ctx.beginPath();
          ctx.arc(hx, hy, pxR * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }

        // Metal square insert center
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(cx, cy, pxR * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        const sz = pxR * 0.12;
        ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
      }
      ctx.restore();
    }

    _drawBar(ctx, link, f) {
      const isHalfCut = !!this.options.halfCut;
      const L = link.length;
      const cWidth = isHalfCut ? 0.5 : 1.0; // half-cut 1-hole wide vs full 2-hole C-channel
      const overhang = isHalfCut ? 0.35 : 0.5;

      const p0 = LP.pointAt(f, -overhang, -cWidth / 2);
      const p1 = LP.pointAt(f, L + overhang, -cWidth / 2);
      const p2 = LP.pointAt(f, L + overhang, cWidth / 2);
      const p3 = LP.pointAt(f, -overhang, cWidth / 2);

      const [s0x, s0y] = this.worldToScreen(p0[0], p0[1]);
      const [s1x, s1y] = this.worldToScreen(p1[0], p1[1]);
      const [s2x, s2y] = this.worldToScreen(p2[0], p2[1]);
      const [s3x, s3y] = this.worldToScreen(p3[0], p3[1]);

      // Metal bar body
      const isStage2 = link.stage === 2;
      const baseGrad = ctx.createLinearGradient(s0x, s0y, s3x, s3y);
      if (isStage2) {
        baseGrad.addColorStop(0, '#334155');
        baseGrad.addColorStop(0.5, '#475569');
        baseGrad.addColorStop(1, '#1e293b');
      } else {
        baseGrad.addColorStop(0, '#2b3648');
        baseGrad.addColorStop(0.5, '#3b495e');
        baseGrad.addColorStop(1, '#1c2433');
      }

      ctx.fillStyle = baseGrad;
      ctx.beginPath();
      ctx.moveTo(s0x, s0y);
      ctx.lineTo(s1x, s1y);
      ctx.lineTo(s2x, s2y);
      ctx.lineTo(s3x, s3y);
      ctx.closePath();
      ctx.fill();

      // Aluminum border
      ctx.strokeStyle = isStage2 ? '#94a3b8' : '#7c8ba1';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Draw VEX 0.5" grid holes if scale is large enough
      if (this.options.showHoles && this.scale >= 14) {
        const holeR = Math.max(1.2, 0.08 * this.scale);
        const rows = isHalfCut ? [0] : [-0.5, 0, 0.5]; // half-cut has only the centerline hole row
        const nHoles = Math.floor(L / 0.5) + 1;

        ctx.fillStyle = 'rgba(15, 20, 28, 0.9)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 0.8;

        for (let i = 0; i <= nHoles; i++) {
          const a = i * 0.5;
          for (const b of rows) {
            const hp = LP.pointAt(f, a, b);
            const [hx, hy] = this.worldToScreen(hp[0], hp[1]);
            ctx.beginPath();
            ctx.arc(hx, hy, holeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // Bar Centerline skeleton mark
      const c0 = LP.pointAt(f, 0, 0);
      const c1 = LP.pointAt(f, L, 0);
      const [cs0x, cs0y] = this.worldToScreen(c0[0], c0[1]);
      const [cs1x, cs1y] = this.worldToScreen(c1[0], c1[1]);
      ctx.strokeStyle = isHalfCut ? 'rgba(56, 189, 248, 0.35)' : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cs0x, cs0y);
      ctx.lineTo(cs1x, cs1y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    _drawTower(ctx, link, f, isEnd) {
      const isHalfCut = !!this.options.halfCut;
      let lo = 0, hi = 0;
      if (link.pivots.length) {
        let minP = Infinity, maxP = -Infinity;
        link.pivots.forEach((p) => {
          minP = Math.min(minP, p[1]);
          maxP = Math.max(maxP, p[1]);
        });
        lo = minP - 0.75;
        hi = maxP + 0.75;
      } else {
        lo = -1; hi = 5;
      }
      if (link.kind === 'ground') {
        lo = Math.min(lo, -2.0); // tower anchors to chassis
      }

      const tw = isHalfCut ? 0.25 : 1.0; // half width (0.5" total width on half-cuts)
      const p0 = LP.pointAt(f, -tw, lo);
      const p1 = LP.pointAt(f, tw, lo);
      const p2 = LP.pointAt(f, tw, hi);
      const p3 = LP.pointAt(f, -tw, hi);

      const [s0x, s0y] = this.worldToScreen(p0[0], p0[1]);
      const [s1x, s1y] = this.worldToScreen(p1[0], p1[1]);
      const [s2x, s2y] = this.worldToScreen(p2[0], p2[1]);
      const [s3x, s3y] = this.worldToScreen(p3[0], p3[1]);

      ctx.fillStyle = isEnd ? '#0f766e' : link.kind === 'ground' ? '#1e293b' : '#334155';
      ctx.beginPath();
      ctx.moveTo(s0x, s0y);
      ctx.lineTo(s1x, s1y);
      ctx.lineTo(s2x, s2y);
      ctx.lineTo(s3x, s3y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = isEnd ? '#2dd4bf' : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label
      const midP = LP.pointAt(f, 0, (lo + hi) / 2);
      const [mx, my] = this.worldToScreen(midP[0], midP[1]);
      ctx.fillStyle = isEnd ? '#ccfbf1' : '#cbd5e1';
      ctx.font = 'bold 9px ui-sans-serif, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(link.short || link.name, mx + (isHalfCut ? 24 : 0), my);

      // Holes on tower
      if (this.options.showHoles && this.scale >= 14) {
        const holeR = Math.max(1.2, 0.08 * this.scale);
        ctx.fillStyle = 'rgba(15, 20, 28, 0.85)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 0.8;
        const cols = isHalfCut ? [0] : [-0.5, 0, 0.5];
        for (let b = Math.ceil(lo / 0.5) * 0.5; b <= hi; b += 0.5) {
          for (const a of cols) {
            const hp = LP.pointAt(f, a, b);
            const [hx, hy] = this.worldToScreen(hp[0], hp[1]);
            ctx.beginPath();
            ctx.arc(hx, hy, holeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    }

    _drawBands(ctx, F, segs) {
      const bandColors = [
        '#f97316', // Orange
        '#06b6d4', // Cyan
        '#a855f7', // Purple
        '#ec4899', // Pink
      ];

      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        if (!grp.pts || grp.pts.length < 2) continue;

        const geo = LP.bandGeom(grp, F);
        const wrap = Math.PI * this.band.postD;
        const lam = (grp.n * (geo.P + wrap)) / this.band.C0;

        // Band heat color based on stretch ratio lambda
        let bandColor = bandColors[gi % bandColors.length];
        if (lam > 3.8) {
          bandColor = '#ef4444'; // Red danger
        } else if (lam > 3.2) {
          bandColor = '#f59e0b'; // Amber heavy stretch
        } else if (lam < 1.1) {
          bandColor = '#94a3b8'; // Grey slack
        }

        // Check interference
        const crosses = LP.bandCrossings(this.model, grp, F, segs);
        const hasCross = crosses.size > 0;

        const pts = grp.pts.map((p) => {
          const w = LP.pointAt(F[p.link], p.a, p.b);
          return this.worldToScreen(w[0], w[1]);
        });

        // Fill triangle loop if 3 points
        if (grp.type !== 'line' && pts.length >= 3) {
          ctx.fillStyle = bandColor + (hasCross ? '15' : '22');
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
          ctx.fill();
        }

        // Band strands
        const bandThick = Math.min(8, Math.max(2.5, 1.5 + grp.m * 0.7));
        ctx.strokeStyle = hasCross ? '#ef4444' : bandColor;
        ctx.lineWidth = bandThick;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (hasCross) {
          ctx.setLineDash([6, 3]);
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        if (grp.type !== 'line') ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // Glow effect
        ctx.strokeStyle = hasCross ? 'rgba(239, 68, 68, 0.4)' : bandColor + '44';
        ctx.lineWidth = bandThick + 4;
        ctx.stroke();

        // Label on centroid
        if (pts.length >= 2) {
          let cx = 0, cy = 0;
          pts.forEach((p) => { cx += p[0]; cy += p[1]; });
          cx /= pts.length; cy /= pts.length;

          // Check if too close to any post point
          for (const p of pts) {
            if (Math.hypot(cx - p[0], cy - p[1]) < 24) {
              cy -= 16;
              break;
            }
          }

          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(cx, cy, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = bandColor;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px ui-sans-serif, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`G${gi + 1}`, cx, cy);

          // Stretch info pill next to centroid
          ctx.font = '10px ui-monospace, monospace';
          const stretchText = `λ=${lam.toFixed(2)} (${grp.m}×)`;
          const tw = ctx.measureText(stretchText).width;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.fillRect(cx + 14, cy - 9, tw + 8, 18);
          ctx.strokeStyle = hasCross ? '#ef4444' : 'rgba(56, 189, 248, 0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(cx + 14, cy - 9, tw + 8, 18);

          ctx.fillStyle = hasCross ? '#f87171' : '#38bdf8';
          ctx.fillText(stretchText, cx + 18 + tw / 2, cy);
        }
      }
    }

    _drawPosts(ctx, F) {
      const labels = ['A', 'B', 'C', 'D'];

      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        for (let pi = 0; pi < grp.pts.length; pi++) {
          const pt = grp.pts[pi];
          const f = F[pt.link];
          const w = LP.pointAt(f, pt.a, pt.b);
          const [sx, sy] = this.worldToScreen(w[0], w[1]);

          const isHovered = this.hoveredPost &&
            this.hoveredPost.groupIndex === gi &&
            this.hoveredPost.pointIndex === pi;
          const isDragged = this.draggedPost &&
            this.draggedPost.groupIndex === gi &&
            this.draggedPost.pointIndex === pi;

          const r = Math.max(5, 0.22 * this.scale) + (isHovered || isDragged ? 3 : 0);

          // Post outer standoff flange
          ctx.fillStyle = isDragged ? '#38bdf8' : isHovered ? '#f59e0b' : '#0284c7';
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Hole center mark
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(2, r * 0.4), 0, Math.PI * 2);
          ctx.fill();

          // Badge with letter
          const tag = labels[pi % labels.length];
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px ui-sans-serif, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tag, sx + r + 7, sy - r);

          // If hovered or dragged, show coordinate tooltip
          if (isHovered || isDragged) {
            const linkName = this.model.links[pt.link].short || this.model.links[pt.link].name;
            const link = this.model.links[pt.link];
            let tip = '';
            if (link.kind === 'bar') {
              const holeIdx = LP.inToHoles ? LP.inToHoles(pt.a) : Math.round(pt.a * 2 + 1);
              const offText = pt.b === 0 ? 'Centerline' : (pt.b > 0 ? '+' : '') + pt.b.toFixed(1) + '"';
              tip = `${linkName} [Hole #${holeIdx} (${pt.a.toFixed(1)}"), ${offText}]`;
            } else {
              const holeIdx = LP.inToHoles ? LP.inToHoles(pt.b) : Math.round(pt.b * 2 + 1);
              const offText = pt.a === 0 ? 'Centerline' : (pt.a > 0 ? '+' : '') + pt.a.toFixed(1) + '"';
              tip = `${linkName} [Hole #${holeIdx} (${pt.b.toFixed(1)}"), ${offText}]`;
            }
            ctx.font = '10px ui-sans-serif, sans-serif';
            const tipW = ctx.measureText(tip).width;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
            ctx.fillRect(sx - tipW / 2 - 6, sy - r - 26, tipW + 12, 18);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx - tipW / 2 - 6, sy - r - 26, tipW + 12, 18);

            ctx.fillStyle = '#38bdf8';
            ctx.fillText(tip, sx, sy - r - 17);
          }
        }
      }
    }

    _drawCenterOfMass(ctx, F) {
      let totalM = 0;
      let comX = 0, comY = 0;
      for (const l of this.model.links) {
        if (!l.mass) continue;
        const p = LP.pointAt(F[l.idx], l.cg[0], l.cg[1]);
        comX += l.mass * p[0];
        comY += l.mass * p[1];
        totalM += l.mass;
      }
      // Add payload at end effector
      const pl = this.model.cfg.mass.payload;
      if (pl > 0) {
        const e = F[this.model.end.idx];
        comX += pl * e.ox;
        comY += pl * e.oy;
        totalM += pl;
      }
      if (totalM <= 0) return;
      comX /= totalM;
      comY /= totalM;

      const [sx, sy] = this.worldToScreen(comX, comY);
      const r = 7;

      // Classic quadrant CoM icon (black and white / yellow quarters)
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, r, 0, Math.PI / 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, r, Math.PI, Math.PI * 1.5);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#fde68a';
      ctx.font = '9px ui-sans-serif, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('CoM', sx + r + 4, sy + 3);
      ctx.restore();
    }

    _drawHeightTape(ctx, F) {
      const end = F[this.model.end.idx];
      const [endX, endY] = this.worldToScreen(end.ox, end.oy);
      const [groundX, groundY] = this.worldToScreen(end.ox, 0);

      // Height dimension line
      const dimX = endX + 24;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);

      // Horizontal witness lines
      ctx.beginPath();
      ctx.moveTo(endX + 6, endY);
      ctx.lineTo(dimX + 16, endY);
      ctx.moveTo(groundX + 6, groundY);
      ctx.lineTo(dimX + 16, groundY);
      ctx.stroke();

      // Vertical dimension arrow
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(dimX + 8, groundY);
      ctx.lineTo(dimX + 8, endY);
      ctx.stroke();

      // Arrows
      const arr = 4;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(dimX + 8, endY);
      ctx.lineTo(dimX + 8 - arr, endY + arr * 1.5);
      ctx.lineTo(dimX + 8 + arr, endY + arr * 1.5);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(dimX + 8, groundY);
      ctx.lineTo(dimX + 8 - arr, groundY - arr * 1.5);
      ctx.lineTo(dimX + 8 + arr, groundY - arr * 1.5);
      ctx.closePath();
      ctx.fill();

      // Text readout
      const heightInches = end.oy;
      const heightHoles = LP.inToHoles ? LP.inToHoles(heightInches) : Math.round(heightInches * 2 + 1);
      const isHoles = this.options.unit === 'holes';
      const label = isHoles
        ? `H = ${heightHoles} holes (${heightInches.toFixed(1)}")`
        : `H = ${heightInches.toFixed(1)}" (${heightHoles}h)`;

      ctx.save();
      ctx.translate(dimX + 22, (groundY + endY) / 2);
      ctx.fillStyle = '#e0f2fe';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  root.LiftRenderer = LiftRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
