const canvas = document.getElementsByTagName("canvas")[0];
const image = document.getElementsByTagName("p")[0];
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

const params = {
  SIM_RESOLUTION: 128,
  DYE_RESOLUTION: 1024,
  DENSITY_DISSIPATION: 0.995,
  VELOCITY_DISSIPATION: 0.9,
  PRESSURE_ITERATIONS: 10,
  SPLAT_RADIUS: 3 / window.innerHeight,
  color: { r: 0.8, g: 0.5, b: 0.2 },
};

const pointer = {
  x: 0.65 * window.innerWidth,
  y: 0.5 * window.innerHeight,
  dx: 0,
  dy: 0,
  moved: false,
  firstMove: false,
};

let prevTimestamp = Date.now();
const gl = canvas.getContext("webgl");
gl.getExtension("OES_texture_float");

let outputColor, velocity, divergence, pressure;

// Shader creation functions
function createShader(sourceCode, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, sourceCode);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader error:", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function createShaderProgram(vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program error:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function getUniforms(program) {
  const uniforms = {};
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const uniformInfo = gl.getActiveUniform(program, i);
    uniforms[uniformInfo.name] = gl.getUniformLocation(program, uniformInfo.name);
  }
  return uniforms;
}

// Unified input handling
function handleInput(x, y) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const newX = (x - rect.left) * scaleX;
  const newY = (y - rect.top) * scaleY;
  
  pointer.dx = 8 * (newX - pointer.x);
  pointer.dy = 8 * (newY - pointer.y);
  pointer.x = newX;
  pointer.y = newY;
  pointer.moved = true;
  pointer.firstMove = true;
}

// Event listeners
canvas.addEventListener("mousemove", (e) => {
  handleInput(e.clientX, e.clientY);
});

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (e.touches.length > 0) {
    handleInput(e.touches[0].clientX, e.touches[0].clientY);
  }
});

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (e.touches.length > 0) {
    handleInput(e.touches[0].clientX, e.touches[0].clientY);
  }
});

canvas.addEventListener("click", (e) => {
  handleInput(e.clientX, e.clientY);
});

// WebGL utilities
function blit(target) {
  const vertices = new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  if (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function createFBO(w, h, type = gl.RGBA) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, type, w, h, 0, type, gl.FLOAT, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  
  return {
    fbo,
    width: w,
    height: h,
    attach(id) {
      gl.activeTexture(gl.TEXTURE0 + id);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      return id;
    }
  };
}

function createDoubleFBO(w, h, type) {
  let fbo1 = createFBO(w, h, type);
  let fbo2 = createFBO(w, h, type);
  
  return {
    width: w,
    height: h,
    texelSizeX: 1 / w,
    texelSizeY: 1 / h,
    read: () => fbo1,
    write: () => fbo2,
    swap() { [fbo1, fbo2] = [fbo2, fbo1]; }
  };
}

function getResolution(resolution) {
  const aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
  return aspectRatio > 1 ? 
    { width: resolution * aspectRatio, height: resolution } :
    { width: resolution, height: resolution / aspectRatio };
}

// Initialization
function initFBOs() {
  const simRes = getResolution(params.SIM_RESOLUTION);
  const dyeRes = getResolution(params.DYE_RESOLUTION);
  
  outputColor = createDoubleFBO(dyeRes.width, dyeRes.height);
  velocity = createDoubleFBO(simRes.width, simRes.height);
  divergence = createFBO(simRes.width, simRes.height, gl.RGB);
  pressure = createDoubleFBO(simRes.width, simRes.height, gl.RGB);
}

// Shader programs
const vertexShader = createShader(
  document.getElementById("vertShader").innerHTML,
  gl.VERTEX_SHADER
);

const programs = {
  splat: createProgram("fragShaderPoint"),
  divergence: createProgram("fragShaderDivergence"),
  pressure: createProgram("fragShaderPressure"),
  gradientSubtract: createProgram("fragShaderGradientSubtract"),
  advection: createProgram("fragShaderAdvection"),
  display: createProgram("fragShaderDisplay")
};

function createProgram(elId) {
  const fragShader = createShader(
    document.getElementById(elId).innerHTML,
    gl.FRAGMENT_SHADER
  );
  const program = createShaderProgram(vertexShader, fragShader);
  return {
    program,
    uniforms: getUniforms(program)
  };
}

// Main render loop
function render() {
  const dt = (Date.now() - prevTimestamp) / 1000;
  prevTimestamp = Date.now();

  if (!pointer.firstMove) {
    pointer.x = (0.65 + 0.2 * Math.cos(0.006 * prevTimestamp) * Math.sin(0.008 * prevTimestamp)) * canvas.width;
    pointer.y = (0.5 + 0.12 * Math.sin(0.01 * prevTimestamp)) * canvas.height;
    pointer.dx = 10 * (pointer.x - pointer.x);
    pointer.dy = 10 * (pointer.y - pointer.y);
    pointer.moved = true;
  }

  if (pointer.moved) {
    // Velocity splat
    gl.useProgram(programs.splat.program);
    gl.uniform1i(programs.splat.uniforms.u_input_txr, velocity.read().attach(0));
    gl.uniform1f(programs.splat.uniforms.u_ratio, canvas.width / canvas.height);
    gl.uniform2f(programs.splat.uniforms.u_point, pointer.x / canvas.width, 1 - pointer.y / canvas.height);
    gl.uniform3f(programs.splat.uniforms.u_point_value, pointer.dx, -pointer.dy, 1);
    gl.uniform1f(programs.splat.uniforms.u_point_size, params.SPLAT_RADIUS);
    blit(velocity.write());
    velocity.swap();

    // Color splat
    gl.uniform1i(programs.splat.uniforms.u_input_txr, outputColor.read().attach(0));
    gl.uniform3f(programs.splat.uniforms.u_point_value, params.color.r, params.color.g, params.color.b);
    blit(outputColor.write());
    outputColor.swap();
    
    pointer.moved = false;
  }

  // Divergence calculation
  gl.useProgram(programs.divergence.program);
  gl.uniform2f(programs.divergence.uniforms.u_vertex_texel, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1i(programs.divergence.uniforms.u_velocity_txr, velocity.read().attach(0));
  blit(divergence);

  // Pressure solve
  gl.useProgram(programs.pressure.program);
  gl.uniform2f(programs.pressure.uniforms.u_vertex_texel, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1i(programs.pressure.uniforms.u_divergence_txr, divergence.attach(0));
  for (let i = 0; i < params.PRESSURE_ITERATIONS; i++) {
    gl.uniform1i(programs.pressure.uniforms.u_pressure_txr, pressure.read().attach(1));
    blit(pressure.write());
    pressure.swap();
  }

  // Gradient subtract
  gl.useProgram(programs.gradientSubtract.program);
  gl.uniform2f(programs.gradientSubtract.uniforms.u_vertex_texel, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1i(programs.gradientSubtract.uniforms.u_pressure_txr, pressure.read().attach(0));
  gl.uniform1i(programs.gradientSubtract.uniforms.u_velocity_txr, velocity.read().attach(1));
  blit(velocity.write());
  velocity.swap();

  // Velocity advection
  gl.useProgram(programs.advection.program);
  gl.uniform2f(programs.advection.uniforms.u_vertex_texel, velocity.texelSizeX, velocity.texelSizeY);
  gl.uniform1i(programs.advection.uniforms.u_velocity_txr, velocity.read().attach(0));
  gl.uniform1i(programs.advection.uniforms.u_input_txr, velocity.read().attach(0));
  gl.uniform1f(programs.advection.uniforms.u_dt, dt);
  gl.uniform1f(programs.advection.uniforms.u_dissipation, params.VELOCITY_DISSIPATION);
  blit(velocity.write());
  velocity.swap();

  // Density advection
  gl.uniform2f(programs.advection.uniforms.u_vertex_texel, outputColor.texelSizeX, outputColor.texelSizeY);
  gl.uniform1i(programs.advection.uniforms.u_input_txr, outputColor.read().attach(1));
  gl.uniform1f(programs.advection.uniforms.u_dissipation, params.DENSITY_DISSIPATION);
  blit(outputColor.write());
  outputColor.swap();

  // Display
  gl.useProgram(programs.display.program);
  gl.uniform1i(programs.display.uniforms.u_output_texture, outputColor.read().attach(0));
  blit();

  requestAnimationFrame(render);
}

// Initialization
window.addEventListener("resize", () => {
  params.SPLAT_RADIUS = 5 / window.innerHeight;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  initFBOs();
});

initFBOs();
window.setTimeout(() => pointer.firstMove = true, 3000);
render();
image.style.opacity = "1";

// Modify handleInput function
function handleInput(x, y) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const newX = (x - rect.left) * scaleX;
    const newY = (y - rect.top) * scaleY;
    
    // Add momentum smoothing
    pointer.dx = 0.5 * (8 * (newX - pointer.x) + pointer.dx);
    pointer.dy = 0.5 * (8 * (newY - pointer.y) + pointer.dy);
    pointer.x = newX;
    pointer.y = newY;
    pointer.moved = true;
    pointer.firstMove = true;
  }

  // Modify resize handler
window.addEventListener("resize", () => {
    params.SPLAT_RADIUS = 5 / window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    initFBOs();
  });

  // Add these additional event listeners
canvas.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    pointer.moved = false;
  });
  
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    pointer.moved = false;
  });

  // Create these once at initialization
let vertexBuffer, indexBuffer;

function initBuffers() {
  const vertices = new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
}

// Then in blit function:
function blit(target) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  // ... rest of blit code
}

// Add after WebGL context creation
if (!gl) {
    alert('WebGL not supported, please try in a modern browser');
    return;
  }
  
  if (!gl.getExtension('OES_texture_float')) {
    alert('Float textures not supported');
    return;
  }

  // Modify the auto-movement code in render()
if (!pointer.firstMove) {
    const time = prevTimestamp * 0.001;
    pointer.x = (0.65 + 0.2 * Math.cos(time * 0.6) * Math.sin(time * 0.8)) * canvas.width;
    pointer.y = (0.5 + 0.12 * Math.sin(time)) * canvas.height;
    pointer.dx = Math.cos(time) * 2;
    pointer.dy = Math.sin(time) * 2;
    pointer.moved = true;
  }

