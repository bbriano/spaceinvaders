// Briano Goestiawan
// 01 Sep 2021

import { fromEvent, merge } from "rxjs"
import { scan, map, bufferTime } from "rxjs/operators"

// Utility class and functions ------------------------------------- {{{

// Vec2 is an immutable 2 dimensional vector class.
class Vec2 {
	readonly x: number
	readonly y: number

	constructor(x: number, y: number) {
		this.x = x
		this.y = y
	}

	// Make x and y positive.
	abs(): Vec2 {
		return new Vec2(
			Math.abs(this.x),
			Math.abs(this.y),
		)
	}

	// Scale x and y by s.
	scale(s: number): Vec2 {
		return new Vec2(
			this.x * s,
			this.y * s,
		)
	}

	// Return the result of vector addition with v.
	add(v: Vec2): Vec2 {
		return new Vec2(
			this.x + v.x,
			this.y + v.y,
		)
	}
}

// range(n) returns an array with values [0..n-1].
function range(n: number): number[] {
	return [...Array(n).keys()]
}

// cartesian(s, t) does a cartesian product between array s and array t.
// If s and t have different lengths, then the behaviour is undefined.
// Example: cartesian([0,1], ['a','b']) === [[0,'a'], [0,'b'], [1,'a'], [1,'b']].
function cartesian<S, T>(s: S[], t: T[]): [S, T][] {
	return s.reduce((acc: [S, T][], se: S) => [
		...acc,
		...t.map(te => [se, te]),
	] as [S, T][], [])
}

// simpleHash is a simple, insecure, fast hash function.
// Returns an integer in the range [0..2^32).
// Based on bryc's comment on https://gist.github.com/iperelivskiy/4110988
function simpleHash(s: string): number {
	const hash = s.split("").reduce(
		(acc, x) => Math.imul(acc ^ x.charCodeAt(0), 2654435761),
		0xdeadbeef,
	)
	return (hash ^ hash >>> 16) >>> 0
}

// Represent an abstract rectangle type.
interface Rectangle {
	pos: {
		x: number
		y: number
	}
	width: number
	height: number
}

// rectangleRectangleCollide evaluates: Rectangle r1 and Rectangle r2 overlaps.
function rectangleRectangleCollide(r1: Rectangle, r2: Rectangle): boolean {
	return r1.pos.x + r1.width > r2.pos.x &&
		r1.pos.x < r2.pos.x + r2.width &&
		r1.pos.y + r1.height > r2.pos.y &&
		r1.pos.y < r2.pos.y + r2.height
}

// ----------------------------------------------------------------- }}}
// Types ----------------------------------------------------------- {{{

// Immutable game state.
type State = Readonly<{
	gameRunning: boolean
	level: number
	player: Player
	aliens: ReadonlyArray<Alien>
	alienVel: Vec2 // All aliens share this same velocity.
	bullets: ReadonlyArray<Bullet>
	shields: ReadonlyArray<Shield>
	score: number
	ammo: number
	ammoRegenTimer: number // Number of frames until ammo regeneration.
	message: string
}>

type Player = Readonly<{
	pos: Vec2
	width: number
	height: number
}>

type Alien = Readonly<{
	pos: Vec2
	width: number
	height: number
	character: Character
}>

type Bullet = Readonly<{
	shooter: BulletShooter // Who shoots the bullet.
	pos: Vec2
	vel: Vec2
	width: number
	height: number
	character: Character
}>

type Character = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "I" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z"

type BulletShooter = "PLAYER" | "ALIEN"

type Shield = Readonly<{
	pos: Vec2
	width: number
	height: number
}>

// Input is paired with each game frame.
type Input = Readonly<{
	mouse?: Mouse
	keyboard?: Keyboard
}>

type Mouse = Readonly<{
	pos: Vec2
}>

type Keyboard = Readonly<{
	key: string
}>

// ----------------------------------------------------------------- }}}
// Constants ------------------------------------------------------- {{{

const FRAME_TIME = 10 // Time between frames in ms.
const GREEN = "#5da602"
const YELLOW = "#cfad00"
const MAGENTA = "#88658d"
const WHITE = "#dbded8"
const BLACK = "#000000"
const GREY = "#676965"
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

const CANVAS = document.querySelector("#canvas")!
const CANVAS_POS_X = CANVAS.getBoundingClientRect().x
const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 600

const PLAYER_POS_INIT = new Vec2(270, 540)
const PLAYER_WIDTH = 48
const PLAYER_HEIGHT = 32

const ALIEN_WIDTH = 24
const ALIEN_HEIGHT = 20
const ALIEN_SPACING = new Vec2(64, 48)
const ALIEN_DROP_AMOUNT = 30 // Drop amount when aliens hits wall.
const ALIEN_ROWS = 4
const ALIEN_COLS = 6
const ALIEN_POS_INIT = new Vec2(10, 10)
const ALIEN_VEL_INIT = new Vec2(1, 0)
const ALIEN_VEL_INC = new Vec2(.5, .1) // How much alienVel increases by each Level.
const ALIEN_SHOOT_PROB = 0.001 // alien's shooting probability each frame.

const BULLET_WIDTH = 14
const BULLET_HEIGHT = 14
const BULLET_SPEED = 3 // unit: pixel per FRAME_TIME.

const SHIELD_COUNT = 4
const SHIELD_POS = new Vec2(0, 500)
const SHIELD_SPACING = 140
const SHIELD_WIDTH = 80
const SHIELD_HEIGHT = 32
const SHIELD_HEIGHT_REDUCTION = 2 // height remove everytime hit by bullet.

const SCORE_SHOOT_DECREMENT = 20 // Score taken away every time player shoots.
// const SCORE_PER_ALIEN_KILL = 100 // Score earned for every alien killed.
const SCORE_ALIEN_KILL = 100 // Score earned for every alien killed.
const SCORE_ALIEN_KILL_CHAR_MATCH = 400 // Score earned for every alien killed with same character bullet.

const AMMO_MAX = 20
const AMMO_REGEN_AMOUNT = 4
const AMMO_REGEN_TIMER = 1000/FRAME_TIME // Number of frames until ammo regeneration.

const MESSAGE_INIT = "Press [Enter] to play."
const MESSAGE_SCORE = (score: number) => `Oh no. Score: ${String(score)}. ${MESSAGE_INIT}`

// INITIAL_STATE initialise game state based on a seed.
function INITIAL_STATE(seed: string): State {
	return {
		gameRunning: false,
		level: 1,
		player: {
			pos: PLAYER_POS_INIT,
			width: PLAYER_WIDTH,
			height: PLAYER_HEIGHT,
		},
		aliens: cartesian(range(ALIEN_ROWS), range(ALIEN_COLS)).map(([i, j]) => ({
			pos: new Vec2(
				ALIEN_POS_INIT.x + j*ALIEN_SPACING.x,
				ALIEN_POS_INIT.y + i*ALIEN_SPACING.y,
			),
			width: ALIEN_WIDTH,
			height: ALIEN_HEIGHT,
			character: ABC[simpleHash(seed + JSON.stringify([i, j])) % ABC.length] as Character,
		})),
		alienVel: ALIEN_VEL_INIT,
		bullets: [],
		shields: range(SHIELD_COUNT).map(i => {
			const shieldGap = SHIELD_SPACING - SHIELD_WIDTH
			const totalShieldWidth = SHIELD_COUNT * SHIELD_SPACING - shieldGap
			const OFFSET = CANVAS_WIDTH/2 - totalShieldWidth/2
			return {
				pos: new Vec2(
					SHIELD_POS.x + i*SHIELD_SPACING + OFFSET,
					SHIELD_POS.y,
				),
				width: SHIELD_WIDTH,
				height: SHIELD_HEIGHT,
			}
		}),
		score: 0,
		ammo: AMMO_MAX,
		ammoRegenTimer: AMMO_REGEN_TIMER,
		message: MESSAGE_INIT,
	}
}

// ----------------------------------------------------------------- }}}
// State Transitions -- Actions ------------------------------------ {{{

// transition returns the next state given some state and input.
function transition(state: State, input: Input): State {
	// Start the game when user presses [Enter] key.
	if (!state.gameRunning && input.keyboard?.key === "Enter") {
		console.log("ENTER")
		return {
			...INITIAL_STATE(JSON.stringify(state)),
			gameRunning: true,
		}
	}

	// Return early so user cannot modify state if game is not running.
	if (!state.gameRunning) {
		return state
	}

	// newState = ammoRegen(...alienShoot(playerShoot(state, input), input)..., input)
	const newState = [
		playerShoot,
		alienShoot,
		movePlayer,
		moveAlien,
		moveBullet,
		removeBullet,
		playerAlienCollision,
		playerBulletCollision,
		alienBulletCollision,
		shieldBulletCollision,
		noMoreAliens,
		ammoRegen,
	].reduce((s, t) => t(s, input), state)

	return newState
}

// playerShoot creates a bullet at the player's position.
// And decreases score by SCORE_SHOOT_DECREMENT.
function playerShoot(state: State, input: Input): State {
	if (input.keyboard === undefined) {
		return state
	}

	const char = input.keyboard.key.toUpperCase()

	// Only accept keys in ABC.
	if (!ABC.includes(char)) {
		return state
	}

	// No ammo, no shooting.
	if (state.ammo <= 0) {
		return state
	}

	// Place bullet in-front of player.
	const bulletPosX = state.player.pos.x + state.player.width/2 - BULLET_WIDTH/2
	const bulletPosY = state.player.pos.y

	const bullet = {
		shooter: "PLAYER" as BulletShooter,
		pos: new Vec2(bulletPosX, bulletPosY),
		vel: new Vec2(0, -BULLET_SPEED),
		width: BULLET_WIDTH,
		height: BULLET_HEIGHT,
		character: char as Character,
	}

	const bullets = [
		...state.bullets,
		bullet,
	]

	return {
		...state,
		bullets,
		ammo: state.ammo - 1,
		score: state.score - SCORE_SHOOT_DECREMENT,
	}
}

// alienShoot creates a Bullet from each alien with probability ALIEN_SHOOT_PROB.
function alienShoot(state: State, input: Input): State {
	const shootingAliens = state.aliens.filter(alien => {
		const pseudoRandom = simpleHash(
			JSON.stringify(state) + // Unique to current frame.
			JSON.stringify(alien)   // Unique to current alien.
		) / 2**32
		return pseudoRandom < ALIEN_SHOOT_PROB
	})

	const alienBullets = shootingAliens.map(alien => {
		const pos = new Vec2(
			alien.pos.x + alien.width - BULLET_WIDTH/2,
			alien.pos.y + alien.height - BULLET_HEIGHT,
		)
		const pseudoRandomInt = simpleHash(
			JSON.stringify(state) + // Unique to current frame.
			JSON.stringify(alien)   // Unique to current alien.
		)
		return {
			shooter: "ALIEN" as BulletShooter,
			pos,
			vel: new Vec2(0, BULLET_SPEED),
			width: BULLET_WIDTH,
			height: BULLET_HEIGHT,
			character: ABC[pseudoRandomInt % ABC.length] as Character,
		}
	})

	const bullets = [
		...state.bullets,
		...alienBullets,
	]

	return {
		...state,
		bullets,
	}
}

// movePlayer updates player position.
function movePlayer(state: State, input: Input): State {
	if (input.mouse === undefined) {
		return state
	}

	// Set cursor position relative to canvas.
	const cursorX = input.mouse.pos.x - CANVAS_POS_X

	// Keep player within canvas bound.
	const playerPosX = Math.min(
		Math.max(0, cursorX - state.player.width/2),
		CANVAS_WIDTH - state.player.width,
	)

	const player = {
		...state.player,
		pos: new Vec2(playerPosX, state.player.pos.y),
	}

	return {
		...state,
		player,
	}
}

// moveAlien updates aliens positions and velocities.
function moveAlien(state: State, _: Input): State {
	// Get left-most and right-most alien horizontal position.
	const [leftMost, rightMost] = state.aliens.reduce(
		([l, r], alien) => [
			Math.min(l, alien.pos.x),
			Math.max(r, alien.pos.x),
		],
		[CANVAS_WIDTH, 0],
	)

	// Check if aliens hit the walls.
	const hitLeftWall = leftMost + state.alienVel.x < 0
	const hitRightWall = rightMost + ALIEN_WIDTH + state.alienVel.x > CANVAS_WIDTH

	// Reflect horizontal direction if hit either wall.
	const alienVel = hitLeftWall || hitRightWall
		? new Vec2(-1*state.alienVel.x, state.alienVel.y)
		: state.alienVel

	// Offset such that horizontal position is precisely on the wall if will hit it.
	const alienPosXOffset = hitLeftWall
		? 0 - leftMost
		: hitRightWall
			? CANVAS_WIDTH - ALIEN_WIDTH - rightMost
			: alienVel.x

	// Update position of each alien.
	const aliens = state.aliens.map(alien => {
		const alienPosX = alien.pos.x + alienPosXOffset

		// Translate alien down if hits the wall.
		const alienPosY =hitLeftWall || hitRightWall
			? alien.pos.y + ALIEN_DROP_AMOUNT
			: alien.pos.y + alienVel.y

		return {
			...alien,
			pos: new Vec2(alienPosX, alienPosY)
		}
	})

	return {
		...state,
		aliens,
		alienVel,
	}
}

// moveBullet updates bullet positions.
function moveBullet(state: State, _: Input): State {
	const bullets = state.bullets.map(b => ({
		...b,
		pos: b.pos.add(b.vel),
	}))

	return {
		...state,
		bullets,
	}
}

// removeBullet removes out of screen bullets.
function removeBullet(state: State, _: Input): State {
        return {
                ...state,
                bullets: state.bullets.filter(b => b.pos.y > 0),
        }
}

// playerAlienCollision ends the game if the player collides with any alien.
function playerAlienCollision(state: State, _: Input): State {
	const collide = state.aliens.some(a => {
		return rectangleRectangleCollide(state.player, a)
	})

	if (!collide) {
		return state
	}

	return {
		...state,
		gameRunning: false,
		message: MESSAGE_SCORE(state.score),
	}
}

// playerBulletCollision ends the game if the player collides with any alien bullet.
function playerBulletCollision(state: State, _: Input): State {
	const collide = state.bullets.some(b => {
		return b.shooter !== "PLAYER" &&
			rectangleRectangleCollide(state.player, b)
	})

	if (!collide) {
		return state
	}

	return {
		...state,
		gameRunning: false,
		message: MESSAGE_SCORE(state.score),
	}
}

// alienBulletCollision removes alien and bullet that collided and increments score.
function alienBulletCollision(state: State, _: Input): State {
	// Only keep aliens that dont collide with any bullets.
	const aliens = state.aliens.filter(a =>
		!state.bullets.some(b =>
			b.shooter !== "ALIEN" && rectangleRectangleCollide(a, b)
		)
	)

	// Only keep bullets that dont collide with any aliens.
	const bullets = state.bullets.filter(b =>
		!state.aliens.some(a =>
			b.shooter !== "ALIEN" && rectangleRectangleCollide(a, b)
		)
	)

	// Calculate new score.
	const score = state.aliens.reduce((scoreA, a) => {
		return state.bullets.reduce((scoreB, b) => {
			return b.shooter !== "ALIEN" && rectangleRectangleCollide(a, b)
				? a.character === b.character
					? scoreB + SCORE_ALIEN_KILL_CHAR_MATCH
					: scoreB + SCORE_ALIEN_KILL
				: scoreB
		}, scoreA)
	}, state.score)

	return {
		...state,
		aliens,
		bullets,
		score,
	}
}

// shieldBulletCollision reduces height of shield for each bullet it collides with.
function shieldBulletCollision(state: State, _: Input): State {
	// Reduce shield height on collision with bullet.
	const reducedShields = state.shields.map(s => {
		// Number of hits from player's bullet.
		const players = state.bullets.reduce(
			(acc: number, b: Bullet) => rectangleRectangleCollide(s, b) &&
				b.shooter === "PLAYER" ? acc + 1 : acc,
			0,
		)

		// Number of hits from alien's bullet.
		const aliens = state.bullets.reduce(
			(acc: number, b: Bullet) => rectangleRectangleCollide(s, b) &&
				b.shooter === "ALIEN" ? acc + 1 : acc,
			0,
		)

		return {
			...s,
			pos: new Vec2(s.pos.x, s.pos.y + aliens * SHIELD_HEIGHT_REDUCTION),
			height: s.height - (players+aliens) * SHIELD_HEIGHT_REDUCTION,
		}
	})

	// Remove shields with no height.
	const shields = reducedShields.filter(s => s.height > 0)

	// Only keep bullets that dont collide with any shield.
	const bullets = state.bullets.filter(b =>
		!state.shields.some(s =>
			rectangleRectangleCollide(s, b)
		)
	)

	return {
		...state,
		shields,
		bullets,
	}
}

// noMoreAliens returns new level state if there are no more aliens.
function noMoreAliens(state: State, _: Input): State {
	const aliensExists = state.aliens.some(a => {
		return a.pos.y <= state.player.pos.y + state.player.height
	})

	if (aliensExists) {
		return state
	}

	return {
		...state,
		level: state.level + 1,
		aliens: INITIAL_STATE(JSON.stringify(state)).aliens,
		alienVel: state.alienVel.abs().add(ALIEN_VEL_INC),
	}
}

// ammoRegen increments ammo by AMMO_REGEN_AMOUNT but no more than AMMO_MAX.
function ammoRegen(state: State, _: Input): State {
	if (state.ammoRegenTimer > 0) {
		const ammoRegenTimer = state.ammoRegenTimer - 1

		return {
			...state,
			ammoRegenTimer,
		}
	}

	return {
		...state,
		ammo: Math.min(AMMO_MAX, state.ammo + AMMO_REGEN_AMOUNT),
		ammoRegenTimer: AMMO_REGEN_TIMER,
	}
}

// ----------------------------------------------------------------- }}}
// Render Function -- View ----------------------------------------- {{{

// view updates the DOM with data from state.
function view(state: State): void {
	const canvas = document.querySelector("#canvas")!
	canvas.innerHTML = ""

	// If game is not running, print message and exit early.
	if (!state.gameRunning) {
		const message = document.createElementNS(canvas.namespaceURI, "text")
		message.setAttribute("text-anchor", "middle")
		message.setAttribute("fill", GREEN)
		message.setAttribute("x", String(CANVAS_WIDTH/2))
		message.setAttribute("y", String(CANVAS_HEIGHT/2))
		message.innerHTML = state.message
		canvas.append(message)
		return
	}

	// Draw bullets.
	state.bullets.forEach(b => {
		// Draw bullet hitbox -- uncomment for debugging
		// const hitbox = document.createElementNS(canvas.namespaceURI, "rect")
		// hitbox.setAttribute("x", String(b.pos.x))
		// hitbox.setAttribute("y", String(b.pos.y))
		// hitbox.setAttribute("width", String(BULLET_WIDTH))
		// hitbox.setAttribute("height", String(BULLET_HEIGHT))
		// hitbox.setAttribute("stroke", WHITE)
		// canvas.append(hitbox)

		// Draw bullet character.
		const bullet = document.createElementNS(canvas.namespaceURI, "text")
		bullet.setAttribute("font-size", "1rem")
		bullet.setAttribute("text-anchor", "middle")
		bullet.setAttribute("fill", b.shooter === "PLAYER" ? YELLOW : GREEN)
		bullet.setAttribute("x", String(b.pos.x + BULLET_WIDTH/2))
		bullet.setAttribute("y", String(b.pos.y + BULLET_HEIGHT))
		bullet.innerHTML = b.character
		canvas.append(bullet)
	})

	// Draw player.
	const player = document.createElementNS(canvas.namespaceURI, "rect")
	player.setAttribute("x", String(state.player.pos.x))
	player.setAttribute("y", String(state.player.pos.y))
	player.setAttribute("width", String(state.player.width))
	player.setAttribute("height", String(state.player.height))
	player.setAttribute("fill", YELLOW)
	canvas.append(player)

	// Draw aliens.
	state.aliens.forEach(a => {
		// Draw body.
		const alien = document.createElementNS(canvas.namespaceURI, "rect")
		alien.setAttribute("x", String(a.pos.x))
		alien.setAttribute("y", String(a.pos.y))
		alien.setAttribute("width", String(a.width))
		alien.setAttribute("height", String(a.height))
		alien.setAttribute("fill", GREEN)
		canvas.append(alien)

		// Draw character.
		const char = document.createElementNS(canvas.namespaceURI, "text")
		char.setAttribute("font-size", "1rem")
		char.setAttribute("text-anchor", "middle")
		char.setAttribute("fill", BLACK)
		char.setAttribute("x", String(a.pos.x + ALIEN_WIDTH/2))
		char.setAttribute("y", String(a.pos.y + ALIEN_HEIGHT-4))
		char.innerHTML = a.character
		canvas.append(char)
	})

	// Draw shields.
	state.shields.forEach(s => {
		const shield = document.createElementNS(canvas.namespaceURI, "rect")
		shield.setAttribute("x", String(s.pos.x))
		shield.setAttribute("y", String(s.pos.y))
		shield.setAttribute("width", String(s.width))
		shield.setAttribute("height", String(s.height))
		shield.setAttribute("fill", GREY)
		canvas.append(shield)
	})

	// Draw level text.
	const level = document.createElementNS(canvas.namespaceURI, "text")
	level.setAttribute("font-size", "1rem")
	level.setAttribute("x", "12")
	level.setAttribute("y", "24")
	level.setAttribute("fill", MAGENTA)
	level.innerHTML = "level: "+String(state.level)
	canvas.append(level)

	// Draw score text.
	const score = document.createElementNS(canvas.namespaceURI, "text")
	score.setAttribute("font-size", "1rem")
	score.setAttribute("x", "12")
	score.setAttribute("y", "48")
	score.setAttribute("fill", MAGENTA)
	score.innerHTML = "score: "+String(state.score)
	canvas.append(score)

	// Draw ammo text.
	const ammo = document.createElementNS(canvas.namespaceURI, "text")
	ammo.setAttribute("font-size", "1rem")
	ammo.setAttribute("x", "12")
	ammo.setAttribute("y", "72")
	ammo.setAttribute("fill", MAGENTA)
	ammo.innerHTML = "ammo: "+String(state.ammo)
	canvas.append(ammo)
}

// ----------------------------------------------------------------- }}}
// Input Streams and Transduce ------------------------------------- {{{

// mouse$ emits Mouse Input when the user moves the mouse.
const mouse$ = fromEvent<MouseEvent>(document, "mousemove").pipe(
	map((e: MouseEvent) => new Vec2(e.clientX, e.clientY)),
	map((pos: Vec2) => ({pos})),
	map((mouse: Mouse) => ({mouse})),
)

// keyboard$ emits Keyboard Input when the user presses any key.
const keyboard$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
	map((e: KeyboardEvent) => e.key),
	map((key: string) => ({key})),
	map((keyboard: Keyboard) => ({keyboard})),
)

// input$ emits the latest non-null Input properties since the previous input.
// New input is emmited every FRAME_TIME ms.
const input$ = merge(mouse$, keyboard$).pipe(
	bufferTime(FRAME_TIME),
	map((bufferedInput: Input[]) => {
		// Takes the latest non-null properties from the buffered input.
		return bufferedInput.reduce((prev, cur) => ({
			mouse: cur.mouse ?? prev.mouse,
			keyboard: cur.keyboard ?? prev.keyboard,
		}), {})
	}),
)

// Transduce Input stream and render the resulting State stream.
input$.pipe(scan(transition, INITIAL_STATE(""))).subscribe(view)

// ----------------------------------------------------------------- }}}
