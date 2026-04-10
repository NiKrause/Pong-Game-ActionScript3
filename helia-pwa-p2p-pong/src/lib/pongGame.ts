export const PONG_STAGE = {
  width: 900,
  height: 540,
}

const PADDLE_HEIGHT = 104
const PADDLE_WIDTH = 18
const PADDLE_OFFSET = 36
const BALL_SIZE = 16
const PLAYER_SPEED = 430
const START_BALL_SPEED = 280
const MAX_BALL_SPEED = 520
const SPEED_LEVEL_DURATION_MS = 30_000
const MAX_SPEED_LEVEL = 10

export type PongState = {
  width: number
  height: number
  leftY: number
  rightY: number
  ballX: number
  ballY: number
  ballVx: number
  ballVy: number
  leftScore: number
  rightScore: number
  speedLevel: number
  elapsedMs: number
}

export type PaddleInput = -1 | 0 | 1

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function baseBallSpeedForLevel(level: number): number {
  const progress = (level - 1) / (MAX_SPEED_LEVEL - 1)
  return START_BALL_SPEED + (MAX_BALL_SPEED - START_BALL_SPEED) * progress
}

function randomDirection(): number {
  return Math.random() > 0.5 ? 1 : -1
}

function applyLevelSpeed(state: PongState, nextLevel: number): void {
  const previousSpeed = baseBallSpeedForLevel(state.speedLevel)
  const nextSpeed = baseBallSpeedForLevel(nextLevel)
  const ratio = nextSpeed / previousSpeed
  state.ballVx *= ratio
  state.ballVy *= ratio
  state.speedLevel = nextLevel
}

function resetBall(state: PongState, toward: -1 | 1): void {
  const baseSpeed = baseBallSpeedForLevel(state.speedLevel)
  state.ballX = state.width / 2
  state.ballY = state.height / 2
  state.ballVx = toward * baseSpeed
  state.ballVy = randomDirection() * baseSpeed * 0.75
}

export function createInitialPongState(): PongState {
  const state: PongState = {
    width: PONG_STAGE.width,
    height: PONG_STAGE.height,
    leftY: PONG_STAGE.height / 2,
    rightY: PONG_STAGE.height / 2,
    ballX: PONG_STAGE.width / 2,
    ballY: PONG_STAGE.height / 2,
    ballVx: 0,
    ballVy: 0,
    leftScore: 0,
    rightScore: 0,
    speedLevel: 1,
    elapsedMs: 0,
  }
  resetBall(state, randomDirection() as -1 | 1)
  return state
}

export function clonePongState(state: PongState): PongState {
  return {
    width: state.width,
    height: state.height,
    leftY: state.leftY,
    rightY: state.rightY,
    ballX: state.ballX,
    ballY: state.ballY,
    ballVx: state.ballVx,
    ballVy: state.ballVy,
    leftScore: state.leftScore,
    rightScore: state.rightScore,
    speedLevel: state.speedLevel,
    elapsedMs: state.elapsedMs,
  }
}

export function stepPong(
  state: PongState,
  leftInput: PaddleInput,
  rightInput: PaddleInput,
  dtMs: number
): PongState {
  const dt = Math.min(dtMs, 50) / 1000
  const nextLevel = Math.min(MAX_SPEED_LEVEL, Math.floor((state.elapsedMs + dtMs) / SPEED_LEVEL_DURATION_MS) + 1)
  if (nextLevel !== state.speedLevel) {
    applyLevelSpeed(state, nextLevel)
  }
  state.elapsedMs += dtMs

  const paddleHalfHeight = PADDLE_HEIGHT / 2
  const paddleHalfWidth = PADDLE_WIDTH / 2
  const ballHalf = BALL_SIZE / 2
  const leftX = PADDLE_OFFSET
  const rightX = state.width - PADDLE_OFFSET

  state.leftY = clamp(state.leftY + leftInput * PLAYER_SPEED * dt, paddleHalfHeight, state.height - paddleHalfHeight)
  state.rightY = clamp(state.rightY + rightInput * PLAYER_SPEED * dt, paddleHalfHeight, state.height - paddleHalfHeight)

  state.ballX += state.ballVx * dt
  state.ballY += state.ballVy * dt

  if (state.ballY + ballHalf >= state.height || state.ballY - ballHalf <= 0) {
    state.ballVy *= -1
    state.ballY = clamp(state.ballY, ballHalf, state.height - ballHalf)
  }

  if (state.ballVx < 0 && state.ballX - ballHalf <= leftX + paddleHalfWidth) {
    if (Math.abs(state.ballY - state.leftY) <= paddleHalfHeight) {
      state.ballX = leftX + paddleHalfWidth + ballHalf
      state.ballVx = Math.abs(state.ballVx)
      state.ballVy += leftInput * 140
    }
  }

  if (state.ballVx > 0 && state.ballX + ballHalf >= rightX - paddleHalfWidth) {
    if (Math.abs(state.ballY - state.rightY) <= paddleHalfHeight) {
      state.ballX = rightX - paddleHalfWidth - ballHalf
      state.ballVx = -Math.abs(state.ballVx)
      state.ballVy += rightInput * 140
    }
  }

  if (state.ballX + ballHalf >= state.width) {
    state.leftScore += 1
    resetBall(state, -1)
  } else if (state.ballX - ballHalf <= 0) {
    state.rightScore += 1
    resetBall(state, 1)
  }

  return state
}

export function drawPong(
  ctx: CanvasRenderingContext2D,
  state: PongState,
  localRole: 'host' | 'guest' | null
): void {
  const { width, height } = state

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#07131f')
  gradient.addColorStop(1, '#03070d')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.24)'
  ctx.lineWidth = 4
  ctx.setLineDash([12, 14])
  ctx.beginPath()
  ctx.moveTo(width / 2, 24)
  ctx.lineTo(width / 2, height - 24)
  ctx.stroke()
  ctx.setLineDash([])

  const paddleHalfHeight = PADDLE_HEIGHT / 2
  const paddleHalfWidth = PADDLE_WIDTH / 2
  const ballHalf = BALL_SIZE / 2
  const leftX = PADDLE_OFFSET
  const rightX = width - PADDLE_OFFSET

  ctx.fillStyle = localRole === 'host' ? '#7ef0c8' : '#8fc6ff'
  ctx.fillRect(leftX - paddleHalfWidth, state.leftY - paddleHalfHeight, PADDLE_WIDTH, PADDLE_HEIGHT)

  ctx.fillStyle = localRole === 'guest' ? '#7ef0c8' : '#8fc6ff'
  ctx.fillRect(rightX - paddleHalfWidth, state.rightY - paddleHalfHeight, PADDLE_WIDTH, PADDLE_HEIGHT)

  ctx.fillStyle = '#f8fbff'
  ctx.fillRect(state.ballX - ballHalf, state.ballY - ballHalf, BALL_SIZE, BALL_SIZE)

  ctx.fillStyle = 'rgba(238, 246, 255, 0.9)'
  ctx.font = '700 54px system-ui'
  ctx.textAlign = 'center'
  ctx.fillText(String(state.leftScore), width * 0.25, 68)
  ctx.fillText(String(state.rightScore), width * 0.75, 68)

  ctx.fillStyle = 'rgba(154, 180, 203, 0.95)'
  ctx.font = '600 15px system-ui'
  ctx.fillText(`Speed level ${state.speedLevel}`, width / 2, 40)
}
