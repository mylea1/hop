'use strict';

// A radial light wave emitted by the actual local-device icon. Both renderers
// use height-normalized distances, so circles stay circular at any window size.
(() => {
  let canvas = document.getElementById('aurora');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const duration = 2400, rest = 8000;
  let gl, context, program, uniforms;
  let frame = 0, timer = 0, began = -Infinity, lastDraw = 0, disposed = false;
  let origin = { x: .5, y: .5, aspect: 1, reach: 1 };

  function initWebGL() {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER,
      'attribute vec2 position; varying vec2 uv; void main(){uv=vec2(position.x*.5+.5,.5-position.y*.5);gl_Position=vec4(position,0.,1.);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, [
      'precision mediump float;',
      'varying vec2 uv; uniform float progress; uniform float dark; uniform float strength;',
      'uniform vec2 origin; uniform float aspect; uniform float reach;',
      'vec3 spectrum(float t){return .5+.5*cos(6.2831853*(t+vec3(.0,.33,.67)));}',
      'float glow(float x){return exp(-x*x);}',
      'void main(){',
      ' float p=progress;',
      ' vec2 q=vec2((uv.x-origin.x)*aspect,uv.y-origin.y);',
      ' float angle=atan(q.y,q.x+.000001);',
      ' float bend=(.014*sin(angle*3.+p*3.)+.008*sin(angle*7.-p*8.))*smoothstep(0.,.15,p);',
      ' float front=p*reach+bend;',
      ' float d=length(q)-front;',
      ' float fold=.004*sin(angle*13.+p*9.)*smoothstep(0.,.15,p);',
      ' float broad=glow(d/.13);',
      ' float trail=glow((d+.095)/.17);',
      ' float ribbon=glow((d-fold)/.033);',
      ' float fringe=glow((abs(d-fold)-.026)/.009);',
      ' float core=glow((d-fold)/.0035);',
      ' vec3 hue=spectrum(angle/6.2831853+p*.15+d*4.8);',
      ' hue=mix(hue,vec3(.72,.9,1.),core*.75);',
      ' float envelope=smoothstep(.0,.06,p)*(1.-smoothstep(.80,1.,p));',
      ' float alpha=(broad*.19+trail*.1+ribbon*.43+fringe*.2+core*.58)*envelope*strength;',
      ' alpha*=mix(.95,1.12,dark);',
      ' gl_FragColor=vec4(hue,min(alpha,.88));',
      '}'
    ].join('\n')));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    uniforms = Object.fromEntries(['progress', 'dark', 'strength', 'origin', 'aspect', 'reach'].map(name => [name, gl.getUniformLocation(program, name)]));
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); fallback(); resize(); pulse();
    }, { once: true });
    document.documentElement.dataset.wave = 'webgl';
  }

  function fallback() {
    gl = null;
    // Context types cannot be switched on an already initialized canvas.
    const replacement = canvas.cloneNode(false);
    canvas.replaceWith(replacement); canvas = replacement;
    context = canvas.getContext('2d');
    document.documentElement.dataset.wave = 'canvas';
  }
  function resize() {
    locateOrigin();
    const scale = Math.min(devicePixelRatio || 1, 1.5) * .8;
    canvas.width = Math.max(1, Math.round(innerWidth * scale));
    canvas.height = Math.max(1, Math.round(innerHeight * scale));
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    if (reduced.matches && !document.hidden) render(.18, .32);
  }
  function locateOrigin() {
    const icon = document.querySelector('.self-face')?.getBoundingClientRect();
    const x = icon ? (icon.left+icon.width/2)/innerWidth : .5;
    const y = icon ? (icon.top+icon.height/2)/innerHeight : .5;
    const aspect = innerWidth/innerHeight;
    origin = { x, y, aspect, reach: Math.hypot(Math.max(x,1-x)*aspect,Math.max(y,1-y))+.16 };
  }
  function front(angle, p) {
    const t = Math.min(1,p/.15), growth = t*t*(3-2*t);
    return p*origin.reach + (.014*Math.sin(angle*3+p*3)+.008*Math.sin(angle*7-p*8)+.004*Math.sin(angle*13+p*9))*growth;
  }
  function canvasSweep(p, strength) {
    if (!context) return;
    const w = canvas.width, h = canvas.height;
    context.clearRect(0, 0, w, h);
    const ease = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
    const envelope = ease(0,.06,p)*(1-ease(.80,1,p))*strength;
    const cx = origin.x*w, cy = origin.y*h;
    const gradient = context.createConicGradient(0,cx,cy);
    for (let i=0; i<=24; i++) {
      const x=i/24, phase=x+p*.15;
      const rgb=[0,.33,.67].map(offset=>Math.round((.5+.5*Math.cos(2*Math.PI*(phase+offset)))*255));
      gradient.addColorStop(x,'rgb('+rgb.join(',')+')');
    }
    function ribbon(offset,width,blur,alpha,color=gradient) {
      context.beginPath();
      for (let i=0; i<=180; i++) {
        const angle=i/180*Math.PI*2;
        const r=Math.max(0,front(angle,p)+offset)*h;
        const x=cx+Math.cos(angle)*r, y=cy+Math.sin(angle)*r;
        if (!i) context.moveTo(x,y); else context.lineTo(x,y);
      }
      context.closePath();
      context.lineWidth=width*h; context.strokeStyle=color; context.globalAlpha=alpha*envelope;
      context.filter=blur?'blur('+blur*h+'px)':'none'; context.stroke();
    }
    ribbon(-.09,.22,.055,.17);
    ribbon(0,.13,.035,.24);
    ribbon(0,.047,.012,.62);
    ribbon(-.026,.009,.004,.56);
    ribbon(.026,.009,.004,.56);
    ribbon(0,.0035,.0015,.78,'#d9f5ff');
    context.filter='none'; context.globalAlpha=1;
  }
  function render(progress,strength=1) {
    canvas.dataset.progress=progress.toFixed(3);
    if (gl) {
      gl.uniform1f(uniforms.progress,progress);
      gl.uniform1f(uniforms.dark,document.documentElement.dataset.theme==='dark'?1:0);
      gl.uniform1f(uniforms.strength,strength);
      gl.uniform2f(uniforms.origin,origin.x,origin.y);
      gl.uniform1f(uniforms.aspect,origin.aspect);
      gl.uniform1f(uniforms.reach,origin.reach);
      gl.drawArrays(gl.TRIANGLES,0,6);
    } else canvasSweep(progress,strength);
  }
  function clear() {
    if (gl) { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
    else context?.clearRect(0,0,canvas.width,canvas.height);
    canvas.dataset.active='false';
  }
  function stop() { cancelAnimationFrame(frame); clearTimeout(timer); frame=timer=0; }
  function draw(now) {
    if (disposed || document.hidden) return;
    const p=Math.min(1,(now-began)/duration);
    if (gl || now-lastDraw>=32 || p===1) { render(p); lastDraw=now; }
    if (p<1) frame=requestAnimationFrame(draw);
    else { clear(); timer=setTimeout(pulse,rest); }
  }
  function pulse() {
    if (disposed || document.hidden) return;
    stop();
    locateOrigin();
    if (reduced.matches) { render(.18,.32); canvas.dataset.active='false'; return; }
    began=performance.now(); lastDraw=0; canvas.dataset.active='true';
    frame=requestAnimationFrame(draw);
  }

  try { initWebGL(); } catch { fallback(); }
  window.hopWave={pulse};
  addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{stop();if(!document.hidden)pulse();});
  reduced.addEventListener('change',pulse);
  addEventListener('beforeunload',()=>{disposed=true;stop();});
  resize(); pulse();
})();
