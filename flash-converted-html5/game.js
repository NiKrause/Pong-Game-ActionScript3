const stage = {
  width: 550,
  height: 400,
};

const config = {
  originalBallSpeed: 10,
  startBallSpeed: 2,
  maxBallSpeed: 14,
  maxSpeedLevel: 10,
  levelDurationMs: 30000,
  playerSpeed: 7,
  computerSpeed: 10,
  computerIntelligence: 7,
  paddleWidth: 18,
  paddleHeight: 90,
  ballSize: 18,
  paddleInset: 26,
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const playerScoreEl = document.getElementById("player-score");
const speedLevelEl = document.getElementById("speed-level");
const computerScoreEl = document.getElementById("computer-score");

const player = {
  x: config.paddleInset,
  y: stage.height / 2,
  width: config.paddleWidth,
  height: config.paddleHeight,
};

const computer = {
  x: stage.width - config.paddleInset,
  y: stage.height / 2,
  width: config.paddleWidth,
  height: config.paddleHeight,
};

const ball = {
  x: stage.width / 2,
  y: stage.height / 2,
  size: config.ballSize,
};

const state = {
  vx: -config.startBallSpeed,
  vy: config.startBallSpeed,
  v1: 0,
  v2: 0,
  playerScore: 0,
  computerScore: 0,
  speedLevel: 1,
  matchTimeMs: 0,
  lastTimestamp: 0,
};

function getBallSpeed(level) {
  const progress = (level - 1) / (config.maxSpeedLevel - 1);
  return config.startBallSpeed + (config.maxBallSpeed - config.startBallSpeed) * progress;
}

function getSpeedMultiplier() {
  return getBallSpeed(state.speedLevel) / config.originalBallSpeed;
}

function setScores() {
  playerScoreEl.textContent = String(state.playerScore);
  computerScoreEl.textContent = String(state.computerScore);
}

function setSpeedLevelDisplay() {
  speedLevelEl.textContent = String(state.speedLevel);
}

function scaleBallVelocity(factor) {
  state.vx *= factor;
  state.vy *= factor;
}

function updateSpeedLevel(elapsedMs) {
  state.matchTimeMs += elapsedMs;

  const nextLevel = Math.min(
    config.maxSpeedLevel,
    Math.floor(state.matchTimeMs / config.levelDurationMs) + 1,
  );

  if (nextLevel !== state.speedLevel) {
    const previousSpeed = getBallSpeed(state.speedLevel);
    const nextSpeed = getBallSpeed(nextLevel);

    scaleBallVelocity(nextSpeed / previousSpeed);
    state.speedLevel = nextLevel;
    setSpeedLevelDisplay();
  }
}

function reset() {
  const ballSpeed = getBallSpeed(state.speedLevel);

  player.y = stage.height / 2;
  computer.y = stage.height / 2;
  ball.x = stage.width / 2;
  ball.y = stage.height / 2;
  state.vx = Math.abs(Math.random() * 2) > 1 ? -ballSpeed : ballSpeed;
  state.vy = Math.abs(Math.random() * 2) > 1 ? -ballSpeed : ballSpeed;
  state.v1 = 0;
  state.v2 = 0;
}

function clampPaddle(paddle) {
  const halfHeight = paddle.height / 2;

  if (paddle.y + halfHeight > stage.height) {
    paddle.y = stage.height - halfHeight;
  } else if (paddle.y - halfHeight < 0) {
    paddle.y = halfHeight;
  }
}

function onKeyDown(event) {
  if (event.key === "ArrowUp") {
    state.v1 = -config.playerSpeed;
    event.preventDefault();
  } else if (event.key === "ArrowDown") {
    state.v1 = config.playerSpeed;
    event.preventDefault();
  }
}

function onKeyUp(event) {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    state.v1 = 0;
    event.preventDefault();
  }
}

function update(step) {
  const paddleHalfHeight = player.height / 2;
  const paddleHalfWidth = player.width / 2;
  const ballHalfSize = ball.size / 2;
  const speedMultiplier = getSpeedMultiplier();

  player.y += state.v1 * step;
  clampPaddle(player);

  ball.x += state.vx * step;
  ball.y += state.vy * step;

  if (Math.abs(Math.random() * 10) < config.computerIntelligence) {
    const distance = computer.y - ball.y;

    if (Math.abs(distance) > paddleHalfHeight) {
      state.v2 = distance > 0 ? -config.computerSpeed : config.computerSpeed;
    }
  }

  computer.y += state.v2 * step;
  clampPaddle(computer);

  if (ball.y + ballHalfSize >= stage.height || ball.y - ballHalfSize <= 0) {
    state.vy *= -1;
    ball.y = Math.max(ballHalfSize, Math.min(stage.height - ballHalfSize, ball.y));
  }

  if (ball.x - ballHalfSize <= player.x + paddleHalfWidth) {
    if (Math.abs(ball.y - player.y) <= paddleHalfHeight) {
      state.vx = config.originalBallSpeed * speedMultiplier;

      if (state.v1 !== 0) {
        state.vy = 2 * state.v1 * speedMultiplier;
      }
    }
  } else if (ball.x + ballHalfSize >= computer.x - paddleHalfWidth) {
    if (Math.abs(ball.y - computer.y) <= paddleHalfHeight) {
      state.vx = -config.originalBallSpeed * speedMultiplier;

      if (state.v2 !== 0) {
        state.vy = state.v2 * speedMultiplier;
      }
    }
  }

  if (ball.x + ballHalfSize >= stage.width) {
    state.playerScore += 1;
    setScores();
    reset();
  } else if (ball.x - ballHalfSize <= 0) {
    state.computerScore += 1;
    setScores();
    reset();
  }
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, stage.height);
  gradient.addColorStop(0, "#0c1d2f");
  gradient.addColorStop(1, "#040a12");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, stage.width, stage.height);

  ctx.strokeStyle = "rgba(184, 220, 255, 0.22)";
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 14]);
  ctx.beginPath();
  ctx.moveTo(stage.width / 2, 20);
  ctx.lineTo(stage.width / 2, stage.height - 20);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPaddle(paddle, color) {
  const x = paddle.x - paddle.width / 2;
  const y = paddle.y - paddle.height / 2;

  ctx.fillStyle = color;
  ctx.fillRect(x, y, paddle.width, paddle.height);
}

function drawBall() {
  const halfSize = ball.size / 2;

  ctx.fillStyle = "#f8fbff";
  ctx.fillRect(ball.x - halfSize, ball.y - halfSize, ball.size, ball.size);
}

function render() {
  drawBackground();
  drawPaddle(player, "#7ef0c8");
  drawPaddle(computer, "#8fc6ff");
  drawBall();
}

function frame(timestamp) {
  if (!state.lastTimestamp) {
    state.lastTimestamp = timestamp;
  }

  const elapsed = timestamp - state.lastTimestamp;
  state.lastTimestamp = timestamp;
  const step = Math.min(elapsed / (1000 / 60), 2);

  updateSpeedLevel(elapsed);
  update(step);
  render();
  window.requestAnimationFrame(frame);
}

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);

setScores();
setSpeedLevelDisplay();
render();
window.requestAnimationFrame(frame);
