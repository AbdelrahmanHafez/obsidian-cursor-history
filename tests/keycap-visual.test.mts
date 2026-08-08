import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const OVERLAY_REGION = { x: 250, y: 520, width: 780, height: 190 };
const DIFFERENCE_THRESHOLD = 32;

const SAMPLE_TIMES = {
	base: 5.5,
	fadeIn: 5.85,
	held: 6.2,
	fadeOut: 6.6,
	off: 6.82,
};

describe('Cursor History demo keycaps', () => {
	it('uses compact, evenly aligned keyboard keycaps', () => {
		// Arrange
		const { frame } = createTestContext();
		const base = frame('base');
		const held = frame('held');

		// Act
		const overlayBounds = differenceBounds(base, held, OVERLAY_REGION);
		const keycaps = findKeycapBounds(base, held, overlayBounds);
		const glyphs = keycaps.map((keycap) =>
			glyphBounds(base, held, keycap)
		);

		// Assert
		assert.ok(
			overlayBounds.width <= 390,
			`shortcut keycaps must stay compact; detected a ${overlayBounds.width}px-wide overlay`
		);
		assert.ok(
			overlayBounds.height <= 66,
			`shortcut keycaps must use keyboard-like height; detected ${overlayBounds.height}px`
		);
		assert.equal(keycaps.length, 3, 'the shortcut overlay must contain three keycaps');
		assert.ok(
			range(keycaps.map(({ height }) => height)) <= 2,
			'keycaps must share one consistent height'
		);
		assert.ok(
			range(keycapGaps(keycaps)) <= 2,
			'keycaps must use even inter-key gaps'
		);
		assert.ok(
			glyphs.every((glyph, index) =>
				centerDistance(glyph, keycaps[index]) <= 3
			),
			'glyphs must be visually centered inside their keycaps'
		);
		assert.ok(
			range(glyphs.map((glyph, index) => averagePadding(glyph, keycaps[index]))) <= 5,
			'keycaps must use balanced horizontal padding'
		);
	});

	it('fades the shortcut overlay in and out over about 0.2 seconds', () => {
		// Arrange
		const { frame } = createTestContext();
		const base = frame('base');
		const fadeIn = frame('fadeIn');
		const held = frame('held');
		const fadeOut = frame('fadeOut');
		const off = frame('off');

		// Act
		const heldEnergy = differenceEnergy(base, held, OVERLAY_REGION);
		const fadeInRatio = differenceEnergy(base, fadeIn, OVERLAY_REGION) / heldEnergy;
		const fadeOutRatio = differenceEnergy(base, fadeOut, OVERLAY_REGION) / heldEnergy;
		const offRatio = differenceEnergy(base, off, OVERLAY_REGION) / heldEnergy;

		// Assert
		assert.ok(
			fadeInRatio >= 0.2 && fadeInRatio <= 0.8,
			`shortcut fade-in must have partial opacity; measured ${formatRatio(fadeInRatio)}`
		);
		assert.ok(
			fadeOutRatio >= 0.2 && fadeOutRatio <= 0.8,
			`shortcut fade-out must have partial opacity; measured ${formatRatio(fadeOutRatio)}`
		);
		assert.ok(
			offRatio <= 0.08,
			`shortcut overlay must finish fading before navigation; measured ${formatRatio(offRatio)}`
		);
	});

	function createTestContext({
		videoUrl = new URL('../docs/assets/cursor-history-demo.mp4', import.meta.url),
	} = {}) {
		const decodedFrames = new Map<keyof typeof SAMPLE_TIMES, Buffer>();

		return {
			frame(sample: keyof typeof SAMPLE_TIMES) {
				const cached = decodedFrames.get(sample);
				if (cached) {
					return cached;
				}

				const decoded = decodeFrame(fileURLToPath(videoUrl), SAMPLE_TIMES[sample]);
				decodedFrames.set(sample, decoded);
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

function differenceBounds(left: Buffer, right: Buffer, region: Bounds): Bounds {
	let minX = region.x + region.width;
	let minY = region.y + region.height;
	let maxX = -1;
	let maxY = -1;

	forEachPixel(region, (x, y, offset) => {
		if (pixelDifference(left, right, offset) < DIFFERENCE_THRESHOLD) return;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	});

	assert.ok(maxX >= minX && maxY >= minY, 'expected a visible shortcut overlay');
	return {
		x: minX,
		y: minY,
		width: maxX - minX + 1,
		height: maxY - minY + 1,
	};
}

function findKeycapBounds(left: Buffer, right: Buffer, region: Bounds) {
	const width = region.width;
	const height = region.height;
	const mask = new Uint8Array(width * height);

	forEachPixel(region, (x, y, offset) => {
		const red = right[offset];
		const green = right[offset + 1];
		const blue = right[offset + 2];
		const localOffset = (y - region.y) * width + (x - region.x);
		const changed = pixelDifference(left, right, offset) >= 20;
		const purple = blue >= 120 && red >= 60 && blue - green >= 35 && blue - red >= 20;
		if (changed && purple) mask[localOffset] = 1;
	});

	const components = connectedComponents(mask, width, height)
		.filter(({ pixels, width: componentWidth, height: componentHeight }) =>
			pixels >= 80 && componentWidth >= 35 && componentHeight >= 35
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

function glyphBounds(left: Buffer, right: Buffer, keycap: Bounds) {
	let minX = keycap.x + keycap.width;
	let minY = keycap.y + keycap.height;
	let maxX = -1;
	let maxY = -1;

	forEachPixel(keycap, (x, y, offset) => {
		const red = right[offset];
		const green = right[offset + 1];
		const blue = right[offset + 2];
		const neutral = Math.max(red, green, blue) - Math.min(red, green, blue) <= 35;
		const bright = red >= 150 && green >= 150 && blue >= 150;
		if (!neutral || !bright || pixelDifference(left, right, offset) < 20) return;
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

function differenceEnergy(left: Buffer, right: Buffer, region: Bounds) {
	let energy = 0;
	forEachPixel(region, (_x, _y, offset) => {
		energy += Math.abs(left[offset] - right[offset]);
		energy += Math.abs(left[offset + 1] - right[offset + 1]);
		energy += Math.abs(left[offset + 2] - right[offset + 2]);
	});
	return energy;
}

function pixelDifference(left: Buffer, right: Buffer, offset: number) {
	return Math.max(
		Math.abs(left[offset] - right[offset]),
		Math.abs(left[offset + 1] - right[offset + 1]),
		Math.abs(left[offset + 2] - right[offset + 2])
	);
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
