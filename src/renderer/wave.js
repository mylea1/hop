'use strict';

// A quiet iridescent sweep, rendered locally. No textures or network assets.
(() => {
  let canvas = document.getElementById('aurora');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let gl;
  let program;
  let start = performance.now();
  let boost = 0;
  let previous = 0;
  let context;
  let frame;
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `precision mediump float;
      varying vec2 uv; uniform float time; uniform float pulse; uniform float aspect;
      void main(){
        vec2 p=uv; p.x*=aspect;
        float t=time*.12;
        float bend=sin(p.x*2.2-t)*.10+sin(p.x*4.5+t*.8)*.035;
        float center=.66+bend+sin(t*.45)*.22;
        float dist=abs(uv.y-center);
        float wave=exp(-dist*dist/0.017);
        float ribbon=exp(-dist*dist/0.0018);
        vec3 hue=.63+.29*cos(vec3(0.,2.1,4.2)+p.x*2.0+uv.y*2.4+t);
        float vignette=(1.-smoothstep(.1,1.5,length(uv-vec2(.45,.5))));
        float alpha=(wave*.10+ribbon*.045)*(1.+pulse*.75)*vignette;
        gl_FragColor=vec4(hue,alpha);
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  } catch (_) { fallback(); }

  function fallback() {
    gl = null;
    const replacement = canvas.cloneNode(false);
    canvas.replaceWith(replacement); canvas = replacement;
    context = canvas.getContext('2d');
    document.documentElement.dataset.wave = 'canvas';
  }
  function resize() {
    // Half-resolution is ample for this diffuse shader and saves power in the background.
    const scale = Math.min(devicePixelRatio || 1, 1.5) * .65;
    canvas.width = Math.max(1, Math.round(innerWidth * scale));
    canvas.height = Math.max(1, Math.round(innerHeight * scale));
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
  }
  function draw(now) {
    frame = requestAnimationFrame(draw);
    if (document.hidden || now - previous < 33 || (reduced.matches && previous)) return;
    previous = now;
    const time = (now - start) / 1000;
    boost *= .96;
    if (gl) {
      gl.uniform1f(gl.getUniformLocation(program, 'time'), time);
      gl.uniform1f(gl.getUniformLocation(program, 'pulse'), boost);
      gl.uniform1f(gl.getUniformLocation(program, 'aspect'), canvas.width / canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      document.documentElement.dataset.wave = 'webgl';
    } else if (context) {
      const w = canvas.width, h = canvas.height;
      context.clearRect(0, 0, w, h);
      const y = h * (.4 + Math.sin(time * .06) * .15);
      for (let i = 0; i < 3; i++) {
        const x = w * (.15 + .36 * i + Math.sin(time * .08 + i) * .1);
        const gradient = context.createRadialGradient(x, y, 0, x, y, h * .5);
        gradient.addColorStop(0, [`rgba(194,159,216,${.08 + boost*.03})`, `rgba(129,199,177,${.08 + boost*.03})`, `rgba(232,191,149,${.08 + boost*.03})`][i]);
        gradient.addColorStop(1, 'transparent'); context.fillStyle = gradient; context.fillRect(0, 0, w, h);
      }
    }
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fallback(); resize(); });
  addEventListener('resize', () => { resize(); previous = 0; });
  addEventListener('beforeunload', () => cancelAnimationFrame(frame));
  reduced.addEventListener('change', () => { previous = 0; start = performance.now(); });
  window.hopWave = { pulse() { boost = 1; } };
  resize(); frame = requestAnimationFrame(draw);
})();
