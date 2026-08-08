import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const KEYCAP_CANVAS = { x: 440, y: 610, width: 400, height: 100 };
const CLEARLY_VISIBLE_PURPLE_PIXELS = 1_800;

const HISTORY_ACTIONS = [
	{ label: 'Back to C', onset: 6.85 },
	{ label: 'Back to B', onset: 8.6 },
	{ label: 'Back to A', onset: 10.6 },
	{ label: 'Forward to B', onset: 12.6 },
	{ label: 'Forward to C', onset: 14.2 },
	{ label: 'Forward to D', onset: 15.95 },
] as const;

const PHASE_OFFSETS = {
	before: -0.48,
	fadeIn: -0.1,
	preHeld: -0.02,
	onset: 0,
	held: 0.25,
	postHeld: 0.5,
	fadeOut: 0.6,
	off: 0.72,
} as const;

describe('Cursor History demo keycaps', () => {
	for (const { label, onset } of HISTORY_ACTIONS) {
		it(`times the ${label} shortcut card with its action`, () => {
			// Arrange
			const { frame } = createTestContext();

			// Act
			const before = frame(onset + PHASE_OFFSETS.before);
			const fadeIn = frame(onset + PHASE_OFFSETS.fadeIn);
			const preHeld = frame(onset + PHASE_OFFSETS.preHeld);
			const action = frame(onset + PHASE_OFFSETS.onset);
			const held = frame(onset + PHASE_OFFSETS.held);
			const postHeld = frame(onset + PHASE_OFFSETS.postHeld);
			const fadeOut = frame(onset + PHASE_OFFSETS.fadeOut);
			const off = frame(onset + PHASE_OFFSETS.off);
			const fadeInEnergy = differenceEnergy(before, preHeld, KEYCAP_CANVAS);
			const fadeOutEnergy = differenceEnergy(off, postHeld, KEYCAP_CANVAS);
			const fadeInRatio = differenceEnergy(before, fadeIn, KEYCAP_CANVAS) / fadeInEnergy;
			const fadeOutRatio = differenceEnergy(off, fadeOut, KEYCAP_CANVAS) / fadeOutEnergy;
			const keycaps = findKeycapBounds(action);

			// Assert
			assert.equal(
				findKeycapBounds(before).length,
				0,
				`${label} shortcut must still be absent 0.48 seconds before the action`
			);
			assert.equal(
				findKeycapBounds(preHeld).length,
				3,
				`${label} shortcut must finish fading in before the action starts`
			);
			assert.ok(
				countPurplePixels(preHeld, KEYCAP_CANVAS) >= CLEARLY_VISIBLE_PURPLE_PIXELS,
				`${label} shortcut must be clearly visible before the action starts`
			);
			assert.equal(
				keycaps.length,
				3,
				`${label} shortcut must be visible when the action starts`
			);
			assert.ok(
				countPurplePixels(action, KEYCAP_CANVAS) >= CLEARLY_VISIBLE_PURPLE_PIXELS,
				`${label} shortcut must be clearly visible at action onset`
			);
			assert.equal(
				findKeycapBounds(held).length,
				3,
				`${label} shortcut must remain visible 0.25 seconds after the action starts`
			);
			assert.ok(
				countPurplePixels(held, KEYCAP_CANVAS) >= CLEARLY_VISIBLE_PURPLE_PIXELS,
				`${label} shortcut must remain clearly visible 0.25 seconds after the action starts`
			);
			assert.equal(
				findKeycapBounds(postHeld).length,
				3,
				`${label} shortcut must remain visible through the 0.5-second viewport motion`
			);
			assert.ok(
				countPurplePixels(postHeld, KEYCAP_CANVAS) >= CLEARLY_VISIBLE_PURPLE_PIXELS,
				`${label} shortcut must remain clearly visible through the 0.5-second viewport motion`
			);
			assert.ok(
				fadeInRatio >= 0.2 && fadeInRatio <= 0.8,
				`${label} fade-in must have partial opacity halfway through its 0.2-second transition; measured ${formatRatio(fadeInRatio)}`
			);
			assert.ok(
				fadeOutRatio >= 0.2 && fadeOutRatio <= 0.8,
				`${label} fade-out must have partial opacity halfway through its 0.2-second transition; measured ${formatRatio(fadeOutRatio)}`
			);
			assert.equal(
				findKeycapBounds(off).length,
				0,
				`${label} shortcut must finish fading 0.72 seconds after the action starts`
			);

			const overlayBounds = combinedBounds(keycaps);
			const glyphs = keycaps.map((keycap) => glyphBounds(action, keycap));
			assert.ok(
				overlayBounds.width <= 390,
				`${label} shortcut must stay compact; detected a ${overlayBounds.width}px-wide overlay`
			);
			assert.ok(
				overlayBounds.height <= 66,
				`${label} shortcut must use keyboard-like height; detected ${overlayBounds.height}px`
			);
			assert.ok(
				range(keycaps.map(({ height }) => height)) <= 2,
				`${label} keycaps must share one consistent height`
			);
			assert.ok(
				range(keycapGaps(keycaps)) <= 2,
				`${label} keycaps must use even inter-key gaps`
			);
			assert.ok(
				glyphs.every((glyph, index) =>
					centerDistance(glyph, keycaps[index]) <= 3
				),
				`${label} glyphs must be visually centered inside their keycaps`
			);
			assert.ok(
				range(glyphs.map((glyph, index) => averagePadding(glyph, keycaps[index]))) <= 5,
				`${label} keycaps must use balanced horizontal padding`
			);
		});
	}

	function createTestContext({
		videoUrl = new URL('../docs/assets/cursor-history-demo.mp4', import.meta.url),
	} = {}) {
		const decodedFrames = new Map<number, Buffer>();

		return {
			frame(time: number) {
				const cached = decodedFrames.get(time);
				if (cached) {
					return cached;
				}

				const decoded = decodeFrame(fileURLToPath(videoUrl), time);
				decodedFrames.set(time, decoded);
				return decoded;
			},
		};
	}
});

interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

function decodeFrame(videoPath: string, time: number) {
	const result = spawnSync(
		'ffmpeg',
		[
			'-v',
			'error',
			'-ss',
			String(time),
			'-i',
			videoPath,
			'-frames:v',
			'1',
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgb24',
			'pipe:1',
		],
		{ maxBuffer: FRAME_WIDTH * FRAME_HEIGHT * 4 }
	);

	const error = result.error?.message ?? result.stderr.toString().trim();
	assert.equal(result.status, 0, `ffmpeg could not decode the demo frame: ${error}`);
	assert.equal(
		result.stdout.length,
		FRAME_WIDTH * FRAME_HEIGHT * 3,
		`expected a ${FRAME_WIDTH}x${FRAME_HEIGHT} RGB frame`
	);
	return result.stdout;
}

function findKeycapBounds(frame: Buffer) {
	const region = KEYCAP_CANVAS;
	const width = region.width;
	const height = region.height;
	const mask = new Uint8Array(width * height);

	forEachPixel(region, (x, y, offset) => {
		const red = frame[offset];
		const green = frame[offset + 1];
		const blue = frame[offset + 2];
		const localOffset = (y - region.y) * width + (x - region.x);
		if (isPurple(red, green, blue)) mask[localOffset] = 1;
	});

	const components = connectedComponents(mask, width, height)
		.filter(({ pixels, width: componentWidth, height: componentHeight }) =>
			pixels >= 300 && componentWidth >= 40 && componentHeight >= 45
		)
		.map((bounds) => ({
			x: bounds.x + region.x,
			y: bounds.y + region.y,
			width: bounds.width,
			height: bounds.height,
		}))
		.sort((leftBounds, rightBounds) => leftBounds.x - rightBounds.x);

	return components;
}

function combinedBounds(bounds: Bounds[]): Bounds {
	assert.ok(bounds.length > 0, 'expected a visible shortcut overlay');
	const minX = Math.min(...bounds.map(({ x }) => x));
	const minY = Math.min(...bounds.map(({ y }) => y));
	const maxX = Math.max(...bounds.map(({ x, width }) => x + width));
	const maxY = Math.max(...bounds.map(({ y, height }) => y + height));
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function connectedComponents(mask: Uint8Array, width: number, height: number) {
	const seen = new Uint8Array(mask.length);
	const components: Array<Bounds & { pixels: number }> = [];

	for (let start = 0; start < mask.length; ++start) {
		if (!mask[start] || seen[start]) continue;

		const queue = [start];
		seen[start] = 1;
		let cursor = 0;
		let pixels = 0;
		let minX = width;
		let minY = height;
		let maxX = -1;
		let maxY = -1;

		while (cursor < queue.length) {
			const current = queue[cursor++];
			const x = current % width;
			const y = Math.floor(current / width);
			pixels++;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);

			for (const neighbor of neighbors(x, y, width, height)) {
				if (!mask[neighbor] || seen[neighbor]) continue;
				seen[neighbor] = 1;
				queue.push(neighbor);
			}
		}

		components.push({
			x: minX,
			y: minY,
			width: maxX - minX + 1,
			height: maxY - minY + 1,
			pixels,
		});
	}

	return components;
}

function neighbors(x: number, y: number, width: number, height: number) {
	const result: number[] = [];
	if (x > 0) result.push(y * width + x - 1);
	if (x + 1 < width) result.push(y * width + x + 1);
	if (y > 0) result.push((y - 1) * width + x);
	if (y + 1 < height) result.push((y + 1) * width + x);
	return result;
}

function glyphBounds(frame: Buffer, keycap: Bounds) {
	let minX = keycap.x + keycap.width;
	let minY = keycap.y + keycap.height;
	let maxX = -1;
	let maxY = -1;

	forEachPixel(keycap, (x, y, offset) => {
		const red = frame[offset];
		const green = frame[offset + 1];
		const blue = frame[offset + 2];
		const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) <= 35;
		const bright = red >= 150 && green >= 150 && blue >= 150;
		if (!neutral || !bright) return;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	});

	assert.ok(maxX >= minX && maxY >= minY, 'expected a visible glyph in every keycap');
	return {
		x: minX,
		y: minY,
		width: maxX - minX + 1,
		height: maxY - minY + 1,
	};
}

function countPurplePixels(frame: Buffer, region: Bounds) {
	let count = 0;
	forEachPixel(region, (_x, _y, offset) => {
		if (isPurple(frame[offset], frame[offset + 1], frame[offset + 2])) count++;
	});
	return count;
}

function isPurple(red: number, green: number, blue: number) {
	return blue >= 120 && red >= 60 && blue - green >= 35 && blue - red >= 20;
}

function differenceEnergy(left: Buffer, right: Buffer, region: Bounds) {
	let energy = 0;
	forEachPixel(region, (_x, _y, offset) => {
		energy += Math.abs(left[offset] - right[offset]);
		energy += Math.abs(left[offset + 1] - right[offset + 1]);
		energy += Math.abs(left[offset + 2] - right[offset + 2]);
	});
	return energy;
}

function forEachPixel(
	region: Bounds,
	callback: (x: number, y: number, offset: number) => void
) {
	for (let y = region.y; y < region.y + region.height; ++y) {
		for (let x = region.x; x < region.x + region.width; ++x) {
			callback(x, y, (y * FRAME_WIDTH + x) * 3);
		}
	}
}

function keycapGaps(keycaps: Bounds[]) {
	return keycaps.slice(1).map((keycap, index) =>
		keycap.x - (keycaps[index].x + keycaps[index].width)
	);
}

function centerDistance(inner: Bounds, outer: Bounds) {
	const horizontal = Math.abs(
		inner.x + inner.width / 2 - (outer.x + outer.width / 2)
	);
	const vertical = Math.abs(
		inner.y + inner.height / 2 - (outer.y + outer.height / 2)
	);
	return Math.max(horizontal, vertical);
}

function averagePadding(inner: Bounds, outer: Bounds) {
	return (outer.width - inner.width) / 2;
}

function range(values: number[]) {
	return Math.max(...values) - Math.min(...values);
}

function formatRatio(value: number) {
	return value.toFixed(2);
}
