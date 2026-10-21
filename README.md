# VEX DR4B & 6-Bar Banding Optimizer

[![CI & Unit Tests](https://github.com/pgupta9204/optimal-dr4b/actions/workflows/deploy.yml/badge.svg)](https://github.com/pgupta9204/optimal-dr4b/actions/workflows/deploy.yml)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-brightgreen?logo=github)](https://pgupta9204.github.io/optimal-dr4b/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VEX Team](https://img.shields.io/badge/VEX%20Team-10015Z%20Zero%20Tolerance-orange.svg)](https://github.com/pgupta9204/optimal-dr4b)
[![Privacy: COPPA & Zero-Cookie](https://img.shields.io/badge/Privacy-Zero--Cookie%20%7C%20COPPA-emerald)](PRIVACY.md)

An interactive, physics-based kinematic solver and simulated annealing optimizer for **VEX Robotics Double Reverse Four-Bar (DR4B)**, **Six-Bar (6-Bar)**, and **Double Reverse Six-to-Four-Bar (DR6-4B)** linkages.

**🚀 Try the live web application:**  
👉 **[https://pgupta9204.github.io/optimal-dr4b/](https://pgupta9204.github.io/optimal-dr4b/)**

---

## The Engineering Problem

In competitive robotics (VEX Robotics V5RC / VEX U), high-reach lifts such as Double Reverse Four-Bars (DR4B) and 6-Bars suffer from heavy gravitational torque when stowed horizontally:

$$\tau_{\text{gravity}}(\theta) = W_{\text{eff}} \cdot r_{\text{reach}} \cdot \cos(\theta)$$

- At horizontal or negative start angles ($\theta \le 0^\circ$), gravitational torque is at its maximum peak.
- Near full extension ($\theta \approx 65^\circ$), gravitational torque drops significantly.
- Traditional linear rubber banding routes elastic bands between two points, providing near-linear tension that either over-tensions at the top or provides inadequate assist at the bottom.
- Under heavy load, V5 Smart Motors draw excess current, triggering internal thermal limiters and tripping mid-match.

### The Solution: Non-Linear Triangle Banding
By routing closed loops of rubber bands around three standoff posts mounted on moving linkage bars and towers, the rate of change of the triangle perimeter $\frac{dP}{d\theta}$ creates a custom counter-torque:

$$\tau_{\text{band}}(\theta) = T(\lambda) \cdot \frac{dP}{d\theta}$$

By tuning post coordinates $(a_i, b_i)$, triangle geometry dynamically counteracts gravity across the entire stroke, reducing net motor torque by **65% to 98%**.

---

## Key Features

- **Exact 0.5" VEX Hole Grid Locking**: Every standoff coordinate snaps strictly to standard VEX structural pitch (`holes = inches × 2 + 1`). No fractional holes or unbuildable theoretical coordinates.
- **Half-Cut 1x1 C-Channel Skeleton Mode**: Optimizes standoff placement strictly along the centerline ($b = 0$ on bars, $a = 0$ on towers) for lightweight 1x1 C-channels.
- **Simulated Annealing Global Solver**: Multi-restart global search explores millions of valid standoff combinations in ~2.5 seconds to find Pareto-optimal tension layouts.
- **Pivot & Gear Clearance Safety**: Standoffs are enforced to remain $\ge 1.0"$ (2+ holes) away from bearing flat pivots, pinion envelopes, and synchronization gear meshes.
- **Compound Gear Ratio Engine**: Evaluates true motor stall current utilization across standard V5 cartridges (100 / 200 / 600 RPM) and compound gear ratios (e.g., `1:5`, `1:7`, `12:60 * 12:36`).
- **Judged Engineering Notebook Markdown Generator**: One-click export formatted specifically for judged VEX Design and Excellence award documentation.
- **Pit Assembly Build Sheet**: Generates clear, step-by-step standoff hole indices (`Post A on S1 Top Arm: Hole #17`) for pit crews during build sessions.
- **100% Client-Side Privacy**: Runs completely in the browser sandbox. No team CAD dimensions or custom robot geometry are ever uploaded or transmitted.

---

## Kinematic & Mathematical Principles

### 1. Parallelogram Linkage Kinematics
For a standard four-bar linkage of length $L$ and base pivot spacing $s$, the position of any point $(a, b)$ in the local frame of bar $k$ at angle $\theta$ is governed by:

$$\begin{bmatrix} x(\theta) \\ y(\theta) \end{bmatrix} = \mathbf{P}_{\text{root}} + \mathbf{R}(\theta) \begin{bmatrix} a \\ b \end{bmatrix}$$

For multi-stage reverse linkages (DR4B, DR6-4B), stage 2 counter-rotates symmetrically:

$$\theta_2 = -\theta_1$$

Ensuring the end-effector carriage maintains a purely vertical trajectory with constant horizontal coordinate $x_{\text{carriage}}$.

### 2. Rubber Band Elasticity Model
Rubber bands (#32 and #64) exhibit non-linear hyperelastic behavior. The tension $T(\lambda)$ as a function of stretch ratio $\lambda = \frac{L(\theta)}{L_0}$ is modeled as:

$$T(\lambda) = K_1 (\lambda - 1) + K_2 (\lambda - 1)^2 + K_3 \ln\left(\frac{\lambda_{\text{rupture}}}{\lambda_{\text{rupture}} - \lambda}\right)$$

Where bands are constrained to remain within safe operational bounds ($1.15 \le \lambda \le 3.5$) to prevent slack derailment or premature fatigue rupture.

---

## Local Development & Testing

The project has zero external npm dependencies—it runs directly on standard ES6 JavaScript, HTML5 Canvas, and Node.js.

### 1. Running Unit Tests
A comprehensive test suite of 34 kinematic and optimization benchmarks is included:

```bash
node tests/physics.test.js
```

All 34 tests verify:
- Analytic gravity torque against finite difference energy derivatives.
- Vertical carriage alignment ($x_{\text{carriage}} = \text{const}$).
- Non-linear virtual work conservation ($\tau = \frac{dU}{d\theta}$).
- Exact 0.5" VEX hole pitch round-trip conversion.
- Pivot clearance and forbidden gear mesh envelopes.

### 2. Running Locally
Simply open `index.html` in any modern web browser, or use a local static server:

```bash
npx serve .
# Or Python
python3 -m http.server 8080
```

---

## Privacy & Student Data Protection

This tool was designed for high school and middle school robotics students:
- **Zero Cookies**: Does not create, store, or read tracking cookies.
- **COPPA & GDPR Compliant**: Collects zero personally identifiable information (PII). No student names, emails, or IP addresses are stored.
- **Automated Privacy Respect**: Honors browser `Do Not Track` (`DNT: 1`) and `Global Privacy Control` (`GPC: true`) signals automatically.

See [PRIVACY.md](PRIVACY.md) for full compliance disclosures.

---

## Authors & Acknowledgments

- **Engineered by**: VEX Team 10015Z Zero Tolerance
- **Lead Developer**: Pranjal Gupta ([@pgupta9204](https://github.com/pgupta9204))
- **License**: [MIT License](LICENSE)

### Legal Trademark Disclaimer
*VEX* and *VEX Robotics* are registered trademarks of Innovation First International, Inc. This project is an independent open-source educational tool developed by VEX Team 10015Z Zero Tolerance and is not affiliated with, sponsored by, or endorsed by Innovation First International or the Robotics Education & Competition Foundation (RECF).
