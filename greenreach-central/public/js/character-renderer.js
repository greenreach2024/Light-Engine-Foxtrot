/**
 * Advanced Canvas Character Renderer
 * Renders AI-generated SVG character definitions with full animation support
 */

class CharacterRenderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.time = 0;
  }

  /**
   * Render a complete character
   * @param {Object} character - Character definition from AI generator
   * @param {number} x - Center X position
   * @param {number} y - Center Y position
   * @param {number} size - Base size multiplier
   * @param {number} time - Animation time
   */
  render(character, x, y, size, time) {
    this.time = time;
    const ctx = this.ctx;
    
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);

    // Apply global animations
    this.applyGlobalAnimation(character.animation);

    // Render body parts
    this.renderPaths(character.paths, character.colors);

    // Render eyes
    this.renderEyes(character.eyes, character.colors);

    // Render mouth
    this.renderMouth(character.mouth, character.colors);

    // Render particles
    if (character.particles) {
      this.renderParticles(character.particles, character.colors, size);
    }

    ctx.restore();
  }

  applyGlobalAnimation(animation) {
    if (!animation) return;

    // Float animation
    if (animation.float) {
      const offset = Math.sin(this.time * animation.float.frequency) * animation.float.amplitude;
      this.ctx.translate(0, offset * 100);
    }

    // Breathe/scale animation
    if (animation.breathe) {
      const scale = 1 + Math.sin(this.time * animation.breathe.frequency) * animation.breathe.amplitude;
      this.ctx.scale(scale, scale);
    }

    // Idle sway
    if (animation.idle) {
      const sway = Math.sin(this.time * animation.idle.frequency) * animation.idle.amplitude;
      this.ctx.rotate(sway);
    }

    // Sway (for plants)
    if (animation.sway) {
      const sway = Math.sin(this.time * animation.sway.frequency) * animation.sway.amplitude;
      this.ctx.rotate(sway);
    }
  }

  renderPaths(paths, colors) {
    const ctx = this.ctx;

    // Render body
    if (paths.body) {
      ctx.fillStyle = colors.primary;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      this.drawPath(paths.body, 100);
      ctx.fill();
      ctx.stroke();

      // Add gradient overlay
      if (colors.secondary) {
        const gradient = ctx.createRadialGradient(-20, -30, 0, 0, 0, 80);
        gradient.addColorStop(0, colors.secondary);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    }

    // Render stem (for plants)
    if (paths.stem) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      this.drawPath(paths.stem, 100);
      ctx.stroke();
    }

    // Render head (for bots/plants)
    if (paths.head) {
      ctx.fillStyle = colors.primary;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      this.drawPath(paths.head, 100);
      ctx.fill();
      ctx.stroke();
    }

    // Render wings (for clouds)
    if (paths.leftWing) {
      ctx.save();
      const wingFlap = paths.wingFlap || 0.1;
      const flapAngle = Math.sin(this.time * 0.04) * wingFlap;
      
      ctx.translate(-40, 0);
      ctx.rotate(flapAngle);
      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = 0.7;
      this.drawPath(paths.leftWing, 100);
      ctx.fill();
      ctx.restore();
    }

    if (paths.rightWing) {
      ctx.save();
      const wingFlap = paths.wingFlap || 0.1;
      const flapAngle = Math.sin(this.time * 0.04) * wingFlap;
      
      ctx.translate(40, 0);
      ctx.rotate(-flapAngle);
      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = 0.7;
      this.drawPath(paths.rightWing, 100);
      ctx.fill();
      ctx.restore();
    }

    // Render tentacles/arms
    ['leftArm', 'rightArm', 'tail'].forEach((limb, idx) => {
      if (paths[limb]) {
        ctx.save();
        const wave = Math.sin(this.time * 0.03 + idx * 0.5) * 0.2;
        if (limb === 'leftArm') ctx.translate(-30, 0);
        if (limb === 'rightArm') ctx.translate(30, 0);
        if (limb === 'tail') ctx.translate(0, 30);
        ctx.rotate(wave);
        
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        this.drawPath(paths[limb], 100);
        ctx.stroke();
        ctx.restore();
      }
    });

    // Render leaves
    if (paths.leaves && Array.isArray(paths.leaves)) {
      paths.leaves.forEach((leaf, idx) => {
        ctx.save();
        const rustle = Math.sin(this.time * 0.05 + idx) * 0.15;
        const distance = 40 + idx * 5;
        ctx.translate(
          Math.cos(leaf.angle + rustle) * distance,
          Math.sin(leaf.angle + rustle) * distance
        );
        ctx.rotate(leaf.angle + rustle);
        ctx.fillStyle = colors.accent;
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 1;
        this.drawPath(leaf.path, 100);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    // Render gears
    if (paths.gears && Array.isArray(paths.gears)) {
      paths.gears.forEach((gear, idx) => {
        ctx.save();
        ctx.translate(gear.x * 100, gear.y * 100);
        const rotation = this.time * 0.1 * (idx % 2 === 0 ? 1 : -1);
        ctx.rotate(rotation);
        this.drawGear(gear.radius * 100, gear.teeth, colors.metallic);
        ctx.restore();
      });
    }

    // Render antenna
    if (paths.antenna) {
      ctx.save();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      this.drawPath(paths.antenna, 100);
      ctx.stroke();
      
      // Antenna tip (blinking)
      const blink = Math.sin(this.time * 0.5) > 0 ? 1 : 0.3;
      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = blink;
      ctx.beginPath();
      ctx.arc(0, -65, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Render chassis (for bots)
    if (paths.chassis) {
      ctx.fillStyle = colors.metallic || colors.primary;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      this.drawPath(paths.chassis, 100);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawPath(pathDef, scale) {
    const ctx = this.ctx;
    ctx.beginPath();

    switch (pathDef.type) {
      case 'bezier':
        this.drawBezier(pathDef.points, scale);
        break;
      case 'bezier_smooth':
        this.drawSmoothBezier(pathDef.points, scale, pathDef.closed);
        break;
      case 'quadratic':
        this.drawQuadratic(pathDef.points, scale);
        break;
      case 'smooth':
        this.drawSmooth(pathDef.points, scale);
        break;
      case 'rect':
        this.drawRoundRect(pathDef, scale);
        break;
      case 'line':
        this.drawSimpleLine(pathDef.points, scale);
        break;
    }
  }

  drawBezier(points, scale) {
    if (points.length === 0) return;
    
    this.ctx.moveTo(points[0].x * scale, points[0].y * scale);
    for (let i = 1; i < points.length; i += 3) {
      if (i + 2 < points.length) {
        const cp1 = points[i];
        const cp2 = points[i + 1];
        const end = points[i + 2];
        this.ctx.bezierCurveTo(
          cp1.x * scale, cp1.y * scale,
          cp2.x * scale, cp2.y * scale,
          end.x * scale, end.y * scale
        );
      }
    }
  }

  drawSmoothBezier(points, scale, closed) {
    if (points.length < 2) return;
    
    this.ctx.moveTo(points[0].x * scale, points[0].y * scale);
    
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cp1x = (p0.x + p1.x) / 2 * scale;
      const cp1y = (p0.y + p1.y) / 2 * scale;
      
      this.ctx.quadraticCurveTo(
        p0.x * scale, p0.y * scale,
        cp1x, cp1y
      );
    }
    
    if (closed && points.length > 2) {
      const last = points[points.length - 1];
      const first = points[0];
      const cpx = (last.x + first.x) / 2 * scale;
      const cpy = (last.y + first.y) / 2 * scale;
      this.ctx.quadraticCurveTo(last.x * scale, last.y * scale, cpx, cpy);
    }
  }

  drawQuadratic(points, scale) {
    if (points.length < 3) return;
    this.ctx.moveTo(points[0].x * scale, points[0].y * scale);
    this.ctx.quadraticCurveTo(
      points[1].x * scale, points[1].y * scale,
      points[2].x * scale, points[2].y * scale
    );
  }

  drawSmooth(points, scale) {
    if (points.length < 2) return;
    
    this.ctx.moveTo(points[0].x * scale, points[0].y * scale);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x * scale, points[i].y * scale);
    }
  }

  drawRoundRect(def, scale) {
    const x = def.x * scale;
    const y = def.y * scale;
    const w = def.width * scale;
    const h = def.height * scale;
    const r = (def.rounded || 0) * scale;
    
    this.ctx.roundRect(x, y, w, h, r);
  }

  drawSimpleLine(points, scale) {
    if (points.length < 2) return;
    this.ctx.moveTo(points[0].x * scale, points[0].y * scale);
    this.ctx.lineTo(points[1].x * scale, points[1].y * scale);
  }

  drawGear(radius, teeth, color) {
    const ctx = this.ctx;
    const toothHeight = radius * 0.3;
    const angleStep = (Math.PI * 2) / teeth;
    
    ctx.fillStyle = color;
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < teeth; i++) {
      const angle1 = i * angleStep;
      const angle2 = (i + 0.3) * angleStep;
      const angle3 = (i + 0.7) * angleStep;
      const angle4 = (i + 1) * angleStep;
      
      // Inner point
      ctx.lineTo(Math.cos(angle1) * radius, Math.sin(angle1) * radius);
      // Tooth out
      ctx.lineTo(Math.cos(angle2) * (radius + toothHeight), Math.sin(angle2) * (radius + toothHeight));
      ctx.lineTo(Math.cos(angle3) * (radius + toothHeight), Math.sin(angle3) * (radius + toothHeight));
      // Back to inner
      ctx.lineTo(Math.cos(angle4) * radius, Math.sin(angle4) * radius);
    }
    
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Center hub
    ctx.fillStyle = '#343a40';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  renderEyes(eyesDef, colors) {
    if (!eyesDef) return;
    
    const ctx = this.ctx;
    const size = eyesDef.size * 100;
    const spacing = eyesDef.spacing * 100;
    const yOffset = eyesDef.yOffset * 100;
    
    const drawEye = (x, y) => {
      // White of eye
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      
      if (eyesDef.style === 'digital') {
        // Digital display style
        ctx.fillStyle = colors.primary;
        ctx.fillRect(x - size * 0.6, y - size * 0.3, size * 1.2, size * 0.6);
        
        if (eyesDef.glow) {
          ctx.shadowColor = colors.primary;
          ctx.shadowBlur = 10;
          ctx.fillRect(x - size * 0.6, y - size * 0.3, size * 1.2, size * 0.6);
          ctx.shadowBlur = 0;
        }
      } else {
        // Organic eye with pupil
        const pupilMove = Math.sin(this.time * 0.03) * 0.2;
        
        // Iris
        const irisGradient = ctx.createRadialGradient(
          x + pupilMove * size, y, size * 0.1,
          x, y, size * 0.7
        );
        irisGradient.addColorStop(0, colors.accent);
        irisGradient.addColorStop(1, colors.primary);
        ctx.fillStyle = irisGradient;
        ctx.beginPath();
        ctx.arc(x + pupilMove * size, y, size * 0.6, 0, Math.PI * 2);
        ctx.fill();
        
        // Pupil
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(x + pupilMove * size, y, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        
        // Sparkle
        if (eyesDef.sparkle) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.beginPath();
          ctx.arc(x + pupilMove * size - size * 0.15, y - size * 0.15, size * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
        
        // Reflective shine (for droplet)
        if (eyesDef.reflective) {
          const shineGradient = ctx.createRadialGradient(
            x - size * 0.3, y - size * 0.3, 0,
            x, y, size
          );
          shineGradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
          shineGradient.addColorStop(1, 'transparent');
          ctx.fillStyle = shineGradient;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    
    if (eyesDef.count === 2) {
      drawEye(-spacing / 2, yOffset);
      drawEye(spacing / 2, yOffset);
    } else if (eyesDef.count === 1) {
      drawEye(0, yOffset);
    }
  }

  renderMouth(mouthDef, colors) {
    if (!mouthDef) return;
    
    const ctx = this.ctx;
    const yPos = 25;
    
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    
    switch (mouthDef.type) {
      case 'arc':
        const size = mouthDef.size * 100;
        const startAngle = mouthDef.start * Math.PI;
        const endAngle = mouthDef.end * Math.PI;
        ctx.beginPath();
        if (mouthDef.direction === 'down') {
          ctx.arc(0, yPos - size * 0.5, size, startAngle, endAngle);
        } else {
          ctx.arc(0, yPos + size * 0.5, size, Math.PI + startAngle, Math.PI + endAngle, true);
        }
        ctx.stroke();
        break;
        
      case 'line':
        const width = mouthDef.width * 100;
        ctx.beginPath();
        ctx.moveTo(-width / 2, yPos);
        ctx.lineTo(width / 2, yPos);
        ctx.stroke();
        break;
        
      case 'segments':
        // Digital mouth (segments)
        const segSize = mouthDef.size * 100;
        ctx.fillStyle = colors.primary;
        mouthDef.pattern.forEach((on, i) => {
          if (on) {
            const x = (i - mouthDef.pattern.length / 2) * segSize * 1.5;
            ctx.fillRect(x, yPos - segSize / 2, segSize, segSize);
          }
        });
        break;
        
      case 'oval':
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.ellipse(0, yPos, mouthDef.width * 100, mouthDef.height * 100, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }

  renderParticles(particlesDef, colors, baseSize) {
    const ctx = this.ctx;
    const count = particlesDef.count;
    const speed = particlesDef.speed;
    
    for (let i = 0; i < count; i++) {
      const angle = (this.time * speed * 0.5 + i * Math.PI * 2 / count) % (Math.PI * 2);
      const distance = 70 + Math.sin(this.time * 0.02 + i) * 20;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.3 + Math.sin(this.time * 0.1 + i) * 0.3;
      
      switch (particlesDef.type) {
        case 'sparkles':
          ctx.fillStyle = '#ffd700';
          ctx.font = '16px sans-serif';
          ctx.fillText('✨', -8, 8);
          break;
          
        case 'bubbles':
          const bubbleSize = 4 + Math.sin(this.time * 0.15 + i) * 2;
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, bubbleSize, 0, Math.PI * 2);
          ctx.stroke();
          break;
          
        case 'wind_swirls':
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(0, 0, 8, 0, Math.PI * 1.5);
          ctx.stroke();
          break;
          
        case 'sparks':
          ctx.fillStyle = colors.primary;
          ctx.beginPath();
          ctx.moveTo(0, -6);
          ctx.lineTo(2, 0);
          ctx.lineTo(0, 6);
          ctx.lineTo(-2, 0);
          ctx.closePath();
          ctx.fill();
          break;
      }
      
      ctx.restore();
    }
  }
}

// Export for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CharacterRenderer;
} else {
  window.CharacterRenderer = CharacterRenderer;
}
